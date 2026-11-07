"""Verify a signed test app, then bind the extracted download and checksums to proof."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import platform
import plistlib
import re
import shutil
import ssl
import subprocess
import sys
import tempfile
import time

ROOT = Path(__file__).resolve().parent.parent
MACHO = {b'\xcf\xfa\xed\xfe', b'\xfe\xed\xfa\xcf', b'\xce\xfa\xed\xfe', b'\xfe\xed\xfa\xce',
         b'\xca\xfe\xba\xbe', b'\xbe\xba\xfe\xca', b'\xca\xfe\xba\xbf', b'\xbf\xba\xfe\xca'}


def plain_environment(source=None):
    return {key:value for key,value in (os.environ if source is None else source).items()
            if not key.startswith(('APPLE_', 'CSC_', 'WIN_CSC_'))}


def run(*args, **kwargs):
    return subprocess.run(args, check=True, env=plain_environment(), **kwargs)


def check_signature(path, team):
    run('codesign', '--verify', '--strict', str(path), capture_output=True)
    result = run('codesign', '--display', '--verbose=4', str(path), capture_output=True, text=True)
    details = result.stdout + result.stderr
    if ('Authority=Developer ID Application:' not in details or f'TeamIdentifier={team}\n' not in details or
            not re.search(r'^CodeDirectory .*flags=.*\bruntime\b', details, re.M)):
        raise RuntimeError('Missing hardened Developer ID signature or mismatched Apple team.')


def verify_app(app, team, version):
    info = plistlib.loads((app/'Contents/Info.plist').read_bytes())
    if info.get('CFBundleShortVersionString') != version:
        raise RuntimeError('The app version does not match the test release.')
    if any(key.startswith('SCENE_DIRECTOR_') for key in info.get('LSEnvironment', {})):
        raise RuntimeError('Disposable test settings must not be embedded in the app.')
    executable = app/'Contents/MacOS'/info['CFBundleExecutable']
    if run('lipo', '-archs', str(executable), capture_output=True, text=True).stdout.strip() != 'arm64':
        raise RuntimeError('The test app is not Apple Silicon arm64.')
    run('codesign', '--verify', '--deep', '--strict', str(app), capture_output=True)
    check_signature(app, team)
    signed = 0
    for path in app.rglob('*'):
        if path.is_symlink() or not path.is_file():
            continue
        with path.open('rb') as source:
            magic = source.read(4)
        if magic in MACHO:
            check_signature(path, team)
            signed += 1
    if signed < 3:
        raise RuntimeError('The app is missing its nested native runtime.')
    result = run('codesign', '--display', '--entitlements', ':-', str(app), capture_output=True)
    xml = result.stdout
    start = xml.find(b'<?xml')
    if start < 0:
        raise RuntimeError('The app has no readable signing entitlements.')
    entitlements = plistlib.loads(xml[start:])
    if not entitlements.get('com.apple.security.cs.allow-jit'):
        raise RuntimeError('The app is missing its Electron JIT entitlement.')
    forbidden = ('com.apple.security.get-task-allow', 'com.apple.security.cs.disable-library-validation',
                 'com.apple.security.cs.allow-unsigned-executable-memory')
    if any(entitlements.get(key) for key in forbidden):
        raise RuntimeError('Unexpected debugging or library-validation exception.')
    backend = app/'Contents/Resources/backend'
    for name in ('index.html','app.js','app.css','prompt-core.js','dataset-core.js','dataset.js','dataset.css','app-icon.png'):
        candidates = list(backend.rglob(name))
        if len(candidates) != 1 or candidates[0].read_bytes() != (ROOT/'web'/name).read_bytes():
            raise RuntimeError('The bundled interface differs from the reviewed source: '+name)
    roots = list(backend.rglob('certificates/cacert.pem'))
    if len(roots) != 1 or not ssl.create_default_context(cafile=str(roots[0])).get_ca_certs():
        raise RuntimeError('The bundled backend has no portable HTTPS roots.')
    for name in ('Electron-LICENSE.txt','LICENSES.chromium.html','Python-LICENSE.txt','PyInstaller-COPYING.txt','certifi-LICENSE.txt'):
        if not (app/'Contents/Resources/licenses'/name).is_file():
            raise RuntimeError('Missing bundled license: '+name)
    run('xcrun', 'stapler', 'validate', str(app), capture_output=True)
    run('spctl', '--assess', '--type', 'execute', '--verbose=2', str(app), capture_output=True)
    return signed


def check_runtime(app):
    backend = app/'Contents/Resources/backend/scene-director-backend'
    env = dict(plain_environment(), SCENE_DIRECTOR_TEST_BACKEND=str(backend))
    subprocess.run([sys.executable,'-m','unittest','test_desktop','-q'], cwd=ROOT, env=env, check=True, timeout=180)
    info = plistlib.loads((app/'Contents/Info.plist').read_bytes())
    engine_version = info['CFBundleShortVersionString'].split('-')[0]
    executable = app/'Contents/MacOS'/info['CFBundleExecutable']
    with tempfile.TemporaryDirectory(prefix='scene-director-native-check-') as directory:
        profile = Path(directory)/'profile'; profile.mkdir()
        (profile/'settings.json').write_text(json.dumps({'api_url':'http://127.0.0.1:9/v1', 'model':'',
                                                        'output_dir':str(Path(directory)/'prompts')}))
        env = dict(plain_environment(), SCENE_DIRECTOR_DESKTOP_DATA_DIR=str(profile))
        with (Path(directory)/'launch.log').open('wb') as log:
            process = subprocess.Popen([str(executable)], env=env, stdout=log, stderr=log)
            try:
                deadline = time.monotonic()+40
                while time.monotonic() < deadline:
                    if process.poll() is not None:
                        raise RuntimeError('The native app exited during its isolated startup check.')
                    status = profile/'desktop.log'
                    text = status.read_text() if status.exists() else ''
                    if f'Local service ready ({engine_version}).' in text and 'App window ready.' in text:
                        break
                    time.sleep(0.1)
                else:
                    raise RuntimeError('The signed native window did not become ready.')
            finally:
                process.terminate()
                try:
                    process.wait(timeout=10)
                except subprocess.TimeoutExpired:
                    process.kill(); process.wait(timeout=5)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--app', type=Path, required=True)
    args = parser.parse_args()
    team = os.environ.get('APPLE_TEAM_ID', '')
    if sys.platform != 'darwin' or platform.machine() != 'arm64' or not re.fullmatch(r'[A-Z0-9]{10}', team):
        parser.error('Verification requires an Apple Silicon Mac and APPLE_TEAM_ID.')
    version = json.loads((ROOT/'desktop/package.json').read_text())['version']
    app = args.app.resolve()
    signed = verify_app(app, team, version)
    check_runtime(app)
    artifacts = ROOT/'desktop/dist'/version/'artifacts'; artifacts.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(prefix='scene-director-release-') as directory:
        release = Path(directory)/'Scene Director macOS Test'; release.mkdir()
        run('ditto', str(app), str(release/'Scene Director.app'))
        shutil.copy2(ROOT/'desktop/README.md',release/'README.md')
        shutil.copy2(ROOT/'desktop/code-signing.md',release/'code-signing.md')
        archive = artifacts/f'Scene_Director_{version}_macOS_arm64.zip'
        run('ditto','-c','-k','--sequesterRsrc','--keepParent',str(release),str(archive))
    with tempfile.TemporaryDirectory(prefix='scene-director-extracted-') as directory:
        run('ditto','-x','-k',str(archive),directory)
        extracted = Path(directory)/'Scene Director macOS Test/Scene Director.app'
        verify_app(extracted, team, version)
        check_runtime(extracted)
    digest = hashlib.sha256(archive.read_bytes()).hexdigest()
    archive.with_name(archive.name+'.sha256').write_text(digest+'  '+archive.name+'\n')
    commit = run('git','rev-parse','HEAD',cwd=ROOT,capture_output=True,text=True).stdout.strip()
    report = {'version':version, 'source_commit':commit, 'archive':archive.name, 'sha256':digest,
              'arch':'arm64','developer_id':True,'hardened_runtime':True,'nested_native_files_verified':signed,
              'stapled_notarization_ticket':True,'gatekeeper':True,'bundled_service_tests':True,
              'native_window_started':True,'extracted_archive_verified':True,'portable_https_roots':True}
    archive.with_name(archive.stem+'.signing.json').write_text(json.dumps(report,indent=2)+'\n')
    print('Verified signed and notarized Apple Silicon archive: '+archive.name)


if __name__ == '__main__':
    main()
