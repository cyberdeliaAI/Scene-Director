"""Strict signature and notarization checks shared by both native Mac builds."""
import os
from pathlib import Path
import plistlib
import re
import ssl
import subprocess

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


def verify_app(app, team, version, arch='arm64'):
    info = plistlib.loads((app/'Contents/Info.plist').read_bytes())
    if info.get('CFBundleShortVersionString') != version:
        raise RuntimeError('The app version does not match the test release.')
    if any(key.startswith('SCENE_DIRECTOR_') for key in info.get('LSEnvironment', {})):
        raise RuntimeError('Disposable test settings must not be embedded in the app.')
    executable = app/'Contents/MacOS'/info['CFBundleExecutable']
    if run('lipo', '-archs', str(executable), capture_output=True, text=True).stdout.strip() != arch:
        raise RuntimeError('The app has the wrong Mac architecture.')
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
