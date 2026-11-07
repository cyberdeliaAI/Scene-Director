"""Verify a native app and its extracted download before recording release proof."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import platform
import plistlib
import shutil
import ssl
import struct
import subprocess
import sys
import tarfile
import tempfile
import zipfile

ROOT = Path(__file__).resolve().parent.parent
TARGETS = ('macos-arm64', 'macos-x64', 'windows-x64', 'linux-x64')
ASSETS = ('index.html','app.js','app.css','prompt-core.js','dataset-core.js','dataset.js','dataset.css','app-icon.png')
LICENSES = ('Electron-LICENSE.txt','LICENSES.chromium.html','Python-LICENSE.txt','PyInstaller-COPYING.txt','certifi-LICENSE.txt')


def plain_environment():
    return {key:value for key,value in os.environ.items() if not key.startswith(('APPLE_','CSC_','WIN_CSC_'))}


def native_target():
    arch = 'arm64' if platform.machine().lower() in ('arm64','aarch64') else 'x64'
    system = {'darwin':'macos','win32':'windows','linux':'linux'}[sys.platform]
    target = system+'-'+arch
    if target not in TARGETS:
        raise RuntimeError('Unsupported native build target: '+target)
    return target


def paths(app, target):
    if target.startswith('macos-'):
        info = plistlib.loads((app/'Contents/Info.plist').read_bytes())
        resources, executable = app/'Contents/Resources', app/'Contents/MacOS'/info['CFBundleExecutable']
    else:
        resources = app/'resources'
        executable = app/('Scene Director.exe' if target=='windows-x64' else 'scene-director')
    backend = resources/'backend'/('scene-director-backend.exe' if target=='windows-x64' else 'scene-director-backend')
    return resources, executable, backend


def verify_architecture(executable, target):
    with executable.open('rb') as source:
        header = source.read(64)
        if target=='windows-x64':
            if header[:2]!=b'MZ':
                raise RuntimeError('Missing native Windows executable.')
            source.seek(struct.unpack_from('<I',header,60)[0])
            pe = source.read(6)
            if pe[:4]!=b'PE\0\0' or struct.unpack_from('<H',pe,4)[0]!=0x8664:
                raise RuntimeError('Expected a Windows x64 executable.')
        elif target=='linux-x64':
            if header[:6]!=b'\x7fELF\x02\x01' or struct.unpack_from('<H',header,18)[0]!=62:
                raise RuntimeError('Expected a Linux x64 executable.')
        else:
            arch = subprocess.check_output(['lipo','-archs',str(executable)],text=True).strip()
            if arch!=('arm64' if target=='macos-arm64' else 'x86_64'):
                raise RuntimeError('The Mac executable has the wrong native architecture.')


def verify_bundle(app, target, version):
    resources, executable, backend = paths(app,target)
    verify_architecture(executable,target)
    verify_architecture(backend,target)
    for name in ASSETS:
        candidates = list((resources/'backend').rglob(name))
        if len(candidates)!=1 or candidates[0].read_bytes()!=(ROOT/'web'/name).read_bytes():
            raise RuntimeError('Bundled interface differs from the reviewed source: '+name)
    roots = list((resources/'backend').rglob('certificates/cacert.pem'))
    if len(roots)!=1 or not ssl.create_default_context(cafile=str(roots[0])).get_ca_certs():
        raise RuntimeError('Missing portable HTTPS roots.')
    for name in LICENSES:
        if not (resources/'licenses'/name).is_file():
            raise RuntimeError('Missing bundled license: '+name)
    if not (resources/'app.asar').is_file():
        raise RuntimeError('The desktop shell is missing.')
    signing = {}
    if target.startswith('macos-'):
        import verify_mac
        team = os.environ.get('APPLE_TEAM_ID','')
        if not team:
            raise RuntimeError('Mac verification requires APPLE_TEAM_ID.')
        count = verify_mac.verify_app(app,team,version,arch='arm64' if target=='macos-arm64' else 'x86_64')
        signing = {'developer_id':True,'hardened_runtime':True,'nested_native_files_verified':count,
                   'stapled_notarization_ticket':True,'gatekeeper':True}
    return signing


def check_runtime(app, target, version):
    _, executable, backend = paths(app,target)
    env = dict(plain_environment(),SCENE_DIRECTOR_TEST_BACKEND=str(backend))
    subprocess.run([sys.executable,'-m','unittest','test_desktop','-q'],cwd=ROOT,env=env,check=True,timeout=180)
    with tempfile.TemporaryDirectory(prefix='scene-director-native-check-') as directory:
        root = Path(directory)
        profile = root/'profile'; profile.mkdir()
        (profile/'settings.json').write_text(json.dumps({'api_url':'http://127.0.0.1:9/v1','model':'','output_dir':str(root/'prompts')}),encoding='utf-8')
        report = root/'interface.json'
        env = dict(plain_environment(),SCENE_DIRECTOR_DESKTOP_DATA_DIR=str(profile),
                   SCENE_DIRECTOR_DESKTOP_SMOKE_REPORT=str(report))
        with (root/'launch.log').open('wb') as log:
            process = subprocess.Popen([str(executable)],env=env,cwd=root,stdout=log,stderr=log)
            try:
                code = process.wait(timeout=60)
            except subprocess.TimeoutExpired:
                process.terminate()
                try: process.wait(timeout=10)
                except subprocess.TimeoutExpired: process.kill(); process.wait(timeout=5)
                raise RuntimeError('The isolated native interface did not complete its startup check.') from None
        result = json.loads(report.read_text()) if report.exists() else {}
        if code or result.get('ok') is not True or result.get('version')!=version:
            diagnostic = (root/'launch.log').read_text(errors='replace')[-4000:]
            raise RuntimeError(f'Native window verification failed: {result}; {diagnostic}')
        expected_system, expected_arch = target.split('-')
        if result.get('arch')!=expected_arch or result.get('platform')!={'macos':'darwin','windows':'win32','linux':'linux'}[expected_system]:
            raise RuntimeError('The running native shell reports the wrong target.')
        log = (profile/'desktop.log').read_text()
        if 'App window ready.' not in log or 'Local service exited (0).' not in log:
            raise RuntimeError('The native shell did not cleanly stop its owned service.')
        print('Verified native interface, renderer isolation and clean service shutdown.',flush=True)


def default_app(target, version):
    folder = ROOT/'desktop/dist'/version
    if target.startswith('macos-'):
        return folder/'signed'/('mac-arm64' if target=='macos-arm64' else 'mac')/'Scene Director.app'
    return folder/('Scene Director-win32-x64' if target=='windows-x64' else 'Scene Director-linux-x64')


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--app',type=Path)
    args = parser.parse_args()
    target = native_target()
    version = json.loads((ROOT/'desktop/package.json').read_text())['version']
    app = (args.app or default_app(target,version)).resolve()
    signing = verify_bundle(app,target,version)
    check_runtime(app,target,version)
    artifacts = ROOT/'desktop/dist'/version/'artifacts'; artifacts.mkdir(parents=True,exist_ok=True)
    stem = f'scene-director-{version}-{target}'
    if target.startswith('macos-'):
        archive = artifacts/(stem+'.zip')
        subprocess.run(['ditto','-c','-k','--sequesterRsrc','--keepParent',str(app),str(archive)],check=True)
    elif target=='windows-x64':
        archive = Path(shutil.make_archive(str(artifacts/stem),'zip',root_dir=app))
    else:
        archive = artifacts/(stem+'.tar.gz')
        with tarfile.open(archive,'w:gz') as packed:
            packed.add(app,arcname='Scene Director')
    with tempfile.TemporaryDirectory(prefix='scene-director-extracted-') as directory:
        extracted = Path(directory)
        if target.startswith('macos-'):
            subprocess.run(['ditto','-x','-k',str(archive),str(extracted)],check=True)
            extracted = extracted/'Scene Director.app'
        elif target=='windows-x64':
            with zipfile.ZipFile(archive) as packed: packed.extractall(extracted)
        else:
            with tarfile.open(archive) as packed: packed.extractall(extracted,filter='data')
            extracted = extracted/'Scene Director'
        verify_bundle(extracted,target,version)
        check_runtime(extracted,target,version)
    digest = hashlib.sha256(archive.read_bytes()).hexdigest()
    archive.with_name(archive.name+'.sha256').write_text(digest+'  '+archive.name+'\n',encoding='ascii')
    commit = subprocess.check_output(['git','rev-parse','HEAD'],cwd=ROOT,text=True).strip()
    proof = dict(version=version,source_commit=commit,target=target,archive=archive.name,sha256=digest,
                 native_architecture=True,bundled_assets=True,portable_https_roots=True,bundled_service_tests=True,
                 native_window_started=True,renderer_isolation=True,clean_service_shutdown=True,extracted_archive_verified=True,**signing)
    (artifacts/(stem+'.verification.json')).write_text(json.dumps(proof,indent=2)+'\n',encoding='utf-8')
    print('Verified extracted native download: '+archive.name,flush=True)


if __name__=='__main__':
    main()
