"""Regression checks for prompt boundaries, per-slot choices and in-flight Stop."""
import json
import tempfile
import threading
import time
import unittest
from pathlib import Path

import scene_director as engine
import scene_director_web as web
from test_scene_director import FakeServer, reference_data, reply


class HistoryRegressionTests(unittest.TestCase):
    def setUp(self):
        self.folder = tempfile.TemporaryDirectory()
        self.root = Path(self.folder.name)
        self.app = web.App({'output_dir':str(self.root)}, settings_file=self.root/'settings.json')

    def tearDown(self):
        self.folder.cleanup()

    def test_generated_multiline_edit_survives_history_hand_edits_and_reopening(self):
        original = 'my_token, (woman:1.2)\n\n35mm,  soft light'
        expected = original.replace('woman','man')
        brief = engine.request_from_json({'workflow':'edit_prompt','source_prompt':original,'changes':'Change the woman to a man.'})[0]
        with FakeServer([expected]) as model:
            self.assertEqual(engine.run(brief,1,engine.Client(model.url),lambda _e:None,output_dir=self.root),0)
        run = self.app.history()['runs'][0]
        self.assertEqual(run['count'],1)
        self.assertEqual(self.app.history_item(run['file'])['prompts'],[expected])
        edited = expected.replace('35mm','50mm')
        self.app.save_run({'file':run['file'],'prompts':[edited],'ideas':['Edited prompt'],'choices':[{}]})
        reopened = web.App({'output_dir':str(self.root)}, settings_file=self.root/'settings.json')
        self.assertEqual(reopened.history_item(run['file'])['prompts'],[edited])
        self.assertEqual(Path(run['file']).read_text(),edited+'\n')

    def test_legacy_edits_stay_whole_and_legacy_scene_files_keep_their_boundaries(self):
        for name, record in [('prompt-edit_old.txt',None),('custom.txt',{'app':engine.APP_NAME,'request':{'workflow':'edit_prompt'}})]:
            path = self.root/name
            path.write_text('my_token, man\n\n35mm, soft light\n')
            if record: path.with_suffix('.json').write_text(json.dumps(record))
            self.assertEqual(self.app.history_item(str(path))['prompts'],['my_token, man\n\n35mm, soft light'])
        scenes = self.root/'krea2_woman_jobs_old.txt'
        scenes.write_text('First prompt.\nSecond prompt.\n')
        self.assertEqual(self.app.history_item(str(scenes))['prompts'],['First prompt.','Second prompt.'])
        # Saving a multiline result in a legacy scene file adds explicit boundaries.
        self.app.save_run({'file':str(scenes),'prompts':['First\nprompt.','Second prompt.'],'ideas':['first','second']})
        self.assertEqual(self.app.history_item(str(scenes))['prompts'],['First\nprompt.','Second prompt.'])
        # An external .txt edit must never be hidden by stale sidecar text.
        scenes.write_text('Externally changed.\n')
        self.assertEqual(self.app.history_item(str(scenes))['prompts'],['Externally changed.'])

    def test_choices_survive_deletion_save_and_history_reload(self):
        parameters = {'framing':'close-up | medium | full body'}
        brief = engine.request_from_json({'subject':'woman','direction':'jobs','parameters':parameters,'count':3})[0]
        events = []
        with FakeServer([reply('carves a spoon','sands a chair','oils a table')]) as model:
            self.assertEqual(engine.run(brief,3,engine.Client(model.url),events.append,output_dir=self.root),0)
        run = self.app.history()['runs'][0]
        item = self.app.history_item(run['file'])
        self.assertEqual(item['choices'],[{'framing':'close-up'},{'framing':'medium'},{'framing':'full body'}])
        self.assertEqual([e['choices'] for e in events if e['type']=='prompt'],item['choices'])
        # Old 3.9 records had no explicit choices: derive them once, then preserve them.
        path = Path(run['file']).with_suffix('.json')
        record = json.loads(path.read_text()); record.pop('choices'); path.write_text(json.dumps(record))
        item = self.app.history_item(run['file'])
        self.assertEqual(item['choices'],[{'framing':'close-up'},{'framing':'medium'},{'framing':'full body'}])
        for key in ('prompts','ideas','choices'): item[key].pop(1)
        self.app.save_run(item)
        reopened = self.app.history_item(run['file'])
        self.assertEqual(reopened['choices'],[{'framing':'close-up'},{'framing':'full body'}])


class CancellationRegressionTests(unittest.TestCase):
    def stop_during_request(self, action, phase):
        entered, release = threading.Event(), threading.Event()
        answers, errors = [], []
        with tempfile.TemporaryDirectory() as folder, FakeServer(['Unused'],vision=True) as model:
            app = web.App({'output_dir':folder}, settings_file=Path(folder)/'settings.json')
            handler = model.server.RequestHandlerClass
            original_post, original_get = handler.do_POST, handler.do_GET

            def delayed_post(request):
                if not request.path.endswith('/chat/completions'):
                    return original_post(request)
                if phase=='stream':
                    request.rfile.read(int(request.headers['Content-Length']))
                    request.send_response(200)
                    request.send_header('Content-Type','text/event-stream')
                    request.end_headers()
                    request.wfile.write(b'data: {"choices":[{"delta":{"content":"Partial caption"}}]}\n\n')
                    request.wfile.flush()
                entered.set()
                release.wait(5)
                if phase=='headers':
                    try: return original_post(request)
                    except (BrokenPipeError,ConnectionResetError): pass

            def delayed_get(request):
                if phase=='models':
                    entered.set(); release.wait(5)
                try: return original_get(request)
                except (BrokenPipeError,ConnectionResetError): pass

            handler.do_POST, handler.do_GET = delayed_post, delayed_get
            data = {'api_url':model.url,'token':'blocked-request'}
            if action=='caption': data.update(rewrite_system='Caption only the crop.',reference_image=reference_data())
            else: data.update(image=reference_data()['data_url'],target='face')

            def request():
                try: answers.append(getattr(app,action)(data))
                except Exception as error: errors.append(error)

            worker = threading.Thread(target=request)
            worker.start()
            try:
                self.assertTrue(entered.wait(3),'Model request never started')
                self.assertEqual(app.stop_vision({'tokens':['blocked-request']})['stopped'],1)
                worker.join(1)
                self.assertFalse(worker.is_alive(),'Stop is still waiting for a model reply')
                self.assertEqual(errors,[])
                self.assertTrue(answers[0]['stopped'])
                self.assertFalse(answers[0]['ok'])
                self.assertNotIn('box',answers[0])
                self.assertNotIn('text',answers[0])
            finally:
                release.set(); worker.join(6)

    def test_caption_stop_interrupts_wait_for_response_headers(self):
        self.stop_during_request('caption','headers')

    def test_caption_stop_interrupts_a_stalled_stream(self):
        self.stop_during_request('caption','stream')

    def test_auto_crop_stop_interrupts_the_request_and_discards_the_box(self):
        self.stop_during_request('locate','headers')

    def test_stop_also_interrupts_model_discovery(self):
        self.stop_during_request('locate','models')

    def test_caption_transport_keeps_authentication_and_compatibility_retries(self):
        with tempfile.TemporaryDirectory() as folder, FakeServer(['A person in a coat.'],vision=True,
                require_key='test-only-key',reject_extras=True,reject_image_uri=True) as model:
            app = web.App({'output_dir':folder},settings_file=Path(folder)/'settings.json')
            result = app.caption({'api_url':model.url,'api_key':'test-only-key','rewrite_system':'Caption only the crop.',
                                  'reference_image':reference_data(),'caption_trigger':'my_token'})
            self.assertTrue(result['ok'],result)
            self.assertEqual(result['text'],'my_token, A person in a coat.')
            self.assertEqual(len(model.requests),3)
            self.assertEqual(app.cancels,{})

    def test_completed_vision_results_are_rejected_if_stop_arrives_at_the_boundary(self):
        stop = threading.Event()

        class LateClient:
            def chat(self,*_args):
                stop.set()
                return '{"box":[100,200,500,900]}'

        with self.assertRaises(engine.Cancelled):
            engine.locate_region(LateClient(),None,'face',stop)
        stop.clear()
        brief = engine.request_from_json({'workflow':'dataset_caption','rewrite_use_vision':True,
            'rewrite_system':'Caption only the crop.','reference_image':reference_data()})[0]
        with self.assertRaises(engine.Cancelled):
            engine.caption_image(brief,LateClient(),stop)

    def test_stop_before_upload_registration_does_not_start_a_model_request(self):
        with tempfile.TemporaryDirectory() as folder:
            app = web.App({'output_dir':folder},settings_file=Path(folder)/'settings.json')
            app.stop_vision({'tokens':['late-upload']})
            result = app.locate({'token':'late-upload','image':reference_data()['data_url'],
                                 'target':'face','api_url':'http://127.0.0.1:9/v1'})
            self.assertTrue(result['stopped'])

    def test_stop_does_not_wait_for_a_free_parallel_slot(self):
        with tempfile.TemporaryDirectory() as folder:
            app = web.App({'output_dir':folder},settings_file=Path(folder)/'settings.json')
            for _ in range(4): app.vision_slots.acquire()
            answers = []
            worker = threading.Thread(target=lambda:answers.append(app._cancellable({'token':'waiting'},lambda _e:self.fail('Cancelled work started'))))
            worker.start()
            try:
                deadline = time.monotonic()+2
                while 'waiting' not in app.cancels and time.monotonic()<deadline: threading.Event().wait(0.01)
                app.stop_vision({'tokens':['waiting']})
                worker.join(1)
                self.assertFalse(worker.is_alive())
                self.assertTrue(answers[0]['stopped'])
            finally:
                for _ in range(4): app.vision_slots.release()
                worker.join(3)


if __name__=='__main__':
    unittest.main()
