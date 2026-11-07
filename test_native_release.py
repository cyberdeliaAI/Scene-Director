"""Native architecture and fail-closed release proof checks."""
import json
from pathlib import Path
import struct
import sys
import tempfile
import unittest
from unittest import mock

sys.path.insert(0,str(Path(__file__).resolve().parent/'desktop'))
import release_native as release
import verify_native as verify


class NativeReleaseTests(unittest.TestCase):
    def proof(self,target='macos-arm64'):
        return dict(version='3.9.0',source_commit='a'*40,target=target,
                    archive=release.names('3.9.0',target)[0],sha256='b'*64,
                    nested_native_files_verified=62,
                    **{key:True for key in release.REQUIRED+release.MAC_REQUIRED})

    def test_requires_current_version_revision_and_target(self):
        for key,value in [('version','3.8.0'),('source_commit','c'*40),('target','windows-x64'),('archive','other.zip'),('sha256','not-a-hash')]:
            proof=self.proof();proof[key]=value
            with self.subTest(key=key),self.assertRaises(RuntimeError):
                release.check_report(proof,'3.9.0','a'*40,'macos-arm64')

    def test_every_runtime_check_and_mac_signing_check_is_required(self):
        for key in release.REQUIRED+release.MAC_REQUIRED:
            for value in [False,None,'true',1]:
                proof=self.proof();proof[key]=value
                with self.subTest(key=key,value=value),self.assertRaises(RuntimeError):
                    release.check_report(proof,'3.9.0','a'*40,'macos-arm64')

    def test_each_platform_has_unique_files_and_valid_proof(self):
        files=[]
        for target in verify.TARGETS:
            names=release.names('3.9.0',target);files.extend(names)
            self.assertEqual(release.check_report(self.proof(target),'3.9.0','a'*40,target),(names[0],'b'*64))
        self.assertEqual(len(set(files)),12)

    def test_refuses_published_releases_and_drafts_for_other_commits(self):
        for draft,commit in [(False,'a'*40),(True,'b'*40)]:
            with mock.patch.object(release,'gh',return_value=json.dumps({'isDraft':draft,'targetCommitish':commit})),self.assertRaises(RuntimeError):
                release.draft('3.9.0','a'*40)

    def test_complete_release_refuses_missing_or_unexpected_downloads(self):
        for assets in [[],[{'name':'other.zip','state':'uploaded'}]]:
            with mock.patch.object(release,'draft',return_value={'assets':assets}),self.assertRaises(RuntimeError):
                release.verify_complete('3.9.0','a'*40)

    def test_windows_native_machine_type(self):
        with tempfile.TemporaryDirectory() as directory:
            path=Path(directory)/'app.exe'
            header=bytearray(64);header[:2]=b'MZ';struct.pack_into('<I',header,60,64)
            path.write_bytes(header+b'PE\0\0'+struct.pack('<H',0x8664))
            verify.verify_architecture(path,'windows-x64')
            path.write_bytes(header+b'PE\0\0'+struct.pack('<H',0xaa64))
            with self.assertRaises(RuntimeError):verify.verify_architecture(path,'windows-x64')

    def test_linux_native_machine_type(self):
        with tempfile.TemporaryDirectory() as directory:
            path=Path(directory)/'app';header=bytearray(64);header[:6]=b'\x7fELF\x02\x01';struct.pack_into('<H',header,18,62)
            path.write_bytes(header);verify.verify_architecture(path,'linux-x64')
            struct.pack_into('<H',header,18,183);path.write_bytes(header)
            with self.assertRaises(RuntimeError):verify.verify_architecture(path,'linux-x64')

    def test_windows_and_linux_paths_keep_resources_and_backend_native(self):
        windows=verify.paths(Path('app'),'windows-x64');linux=verify.paths(Path('app'),'linux-x64')
        self.assertEqual(windows[1].name,'Scene Director.exe')
        self.assertEqual(windows[2].name,'scene-director-backend.exe')
        self.assertEqual(linux[1].name,'scene-director')
        self.assertEqual(linux[2].name,'scene-director-backend')
