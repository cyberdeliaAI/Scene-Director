"""Actual HTTP/TLS I/O checks for cancellation, timeouts and certificate trust."""
from pathlib import Path
import shutil
import ssl
import subprocess
import tempfile
import threading
import time
import unittest
from unittest import mock

import scene_director as engine
from test_scene_director import FakeServer


@unittest.skipUnless(shutil.which('openssl'),'OpenSSL is needed to generate a disposable TLS test certificate')
class RequestTransportTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.folder=tempfile.TemporaryDirectory(prefix='scene-director-test-tls-')
        root=Path(cls.folder.name)
        cls.cert,cls.key=root/'certificate.pem',root/'private-key.pem'
        subprocess.run(['openssl','req','-x509','-newkey','rsa:2048','-sha256','-nodes',
                        '-keyout',str(cls.key),'-out',str(cls.cert),'-days','1','-subj','/CN=localhost',
                        '-addext','subjectAltName=IP:127.0.0.1'],check=True,capture_output=True)

    @classmethod
    def tearDownClass(cls):
        cls.folder.cleanup()

    def server(self,reply='A finished prompt.'):
        model=FakeServer([reply])
        context=ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
        context.load_cert_chain(self.cert,self.key)
        model.server.socket=context.wrap_socket(model.server.socket,server_side=True)
        model.url=model.url.replace('http:','https:')
        return model

    def trusted(self):
        return mock.patch('ssl._create_default_https_context',lambda:ssl.create_default_context(cafile=str(self.cert)))

    def test_large_https_response_keeps_verified_tls(self):
        content='Visible detail. '*40000
        with self.server(content) as model,self.trusted(),engine.CancellableRequests(threading.Event()) as transport:
            result=engine.Client(model.url,transport=transport).request('/chat/completions',{'messages':[{'role':'system','content':'Write one prompt.'},{'role':'user','content':'A quiet workshop.'}]})
            self.assertEqual(result['choices'][0]['message']['content'],content)

    def test_untrusted_https_certificate_is_rejected(self):
        with self.server() as model,engine.CancellableRequests(threading.Event()) as transport:
            with self.assertRaises(engine.GenerationError):
                engine.Client(model.url,transport=transport).request('/models')

    def test_stop_interrupts_https_waiting_for_headers(self):
        entered,release,cancel=threading.Event(),threading.Event(),threading.Event()
        failures=[]
        with self.server() as model,self.trusted():
            handler=model.server.RequestHandlerClass
            original=handler.do_GET
            def stalled(request):
                entered.set();release.wait(5)
                try:original(request)
                except OSError:pass
            handler.do_GET=stalled
            def request():
                try:
                    with engine.CancellableRequests(cancel) as transport:
                        engine.Client(model.url,transport=transport).request('/models')
                except Exception as error:failures.append(error)
            worker=threading.Thread(target=request)
            worker.start()
            try:
                self.assertTrue(entered.wait(3));cancel.set();worker.join(1)
                self.assertFalse(worker.is_alive())
                self.assertEqual(len(failures),1)
                self.assertIsInstance(failures[0],engine.Cancelled)
            finally:
                release.set();worker.join(6)

    def test_timeout_is_not_reset_by_cancellation_polling(self):
        release=threading.Event()
        with FakeServer(['Unused']) as model:
            def stalled(request):release.wait(5)
            model.server.RequestHandlerClass.do_GET=stalled
            started=time.monotonic()
            try:
                with engine.CancellableRequests(threading.Event()) as transport:
                    with self.assertRaises(engine.GenerationError):
                        engine.Client(model.url,timeout=0.15,transport=transport).request('/models')
                self.assertLess(time.monotonic()-started,1)
            finally:release.set()
