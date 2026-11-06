'use strict';

const { packager } = require('@electron/packager');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

async function main() {
  if (process.platform !== 'darwin' || process.arch !== 'arm64') {
    throw new Error('Build this test on an Apple Silicon Mac.');
  }
  const root = path.resolve(__dirname, '..');
  const build = path.join(__dirname, 'build');
  const stage = path.join(build, 'electron-source');
  fs.mkdirSync(stage, { recursive: true });
  for (const file of ['main.cjs', 'preload.cjs', 'folder-picker.cjs', 'dataset-download.cjs', 'package.json']) fs.copyFileSync(path.join(__dirname, file), path.join(stage, file));
  fs.mkdirSync(path.join(build, 'spec'), { recursive: true });
  execFileSync(path.join(__dirname, '.venv', 'bin', 'python'), [
    '-m', 'PyInstaller', '--noconfirm', '--clean', '--onedir', '--target-architecture', 'arm64',
    '--name', 'scene-director-backend', '--distpath', path.join(build, 'python-dist'),
    '--workpath', path.join(build, 'python-work'), '--specpath', path.join(build, 'spec'),
    '--add-data', `${path.join(root, 'web')}:web`, path.join(root, 'scene_director_desktop.py'),
  ], { cwd: root, stdio: 'inherit', env: { ...process.env, PYINSTALLER_CONFIG_DIR: path.join(build, 'pyinstaller-cache') } });
  const version = require('./package.json').version;
  const outputs = await packager({
    dir: stage, name: 'Scene Director', platform: 'darwin', arch: 'arm64',
    icon: path.join(__dirname, 'assets', 'SceneDirector.icns'),
    electronVersion: require('./package.json').devDependencies.electron,
    out: path.join(__dirname, 'dist', version), overwrite: true, asar: true,
    appBundleId: 'com.scenedirector.desktop.test', appVersion: version, buildVersion: '3.7.0.1',
    appCopyright: 'Scene Director',
    extendInfo: { LSMinimumSystemVersion: '13.0', NSHighResolutionCapable: true,
      NSHumanReadableCopyright: 'Scene Director — Apple Silicon test',
      NSLocalNetworkUsageDescription: 'Connect to your local language model server.' },
  });
  const bundle = path.join(outputs[0], 'Scene Director.app');
  const licenses = JSON.parse(execFileSync(path.join(__dirname, '.venv', 'bin', 'python'), ['-c',
    'import json, sys, sysconfig, importlib.metadata as m; from pathlib import Path; print(json.dumps({' +
    '"Python-LICENSE.txt":str(Path(sysconfig.get_path("stdlib"))/"LICENSE.txt"),' +
    '"Python-third-party-licenses.html":str(Path(sys.base_prefix)/"Resources/English.lproj/Documentation/license.html"),' +
    '"PyInstaller-COPYING.txt":str(m.distribution("pyinstaller").locate_file("pyinstaller-6.22.3.dist-info/licenses/COPYING.txt"))}))',
  ], { encoding: 'utf8' }));
  for (const [name, source] of Object.entries(licenses)) {
    if (fs.existsSync(source)) fs.copyFileSync(source, path.join(outputs[0], name));
  }
  fs.cpSync(path.join(build, 'python-dist', 'scene-director-backend'),
    path.join(bundle, 'Contents', 'Resources', 'backend'), { recursive: true, verbatimSymlinks: true });
  // Local ad-hoc signature: this is a test build, not a notarized distribution.
  execFileSync('/usr/bin/codesign', ['--force', '--deep', '--sign', '-', bundle], { stdio: 'inherit' });
  execFileSync('/usr/bin/codesign', ['--verify', '--deep', '--strict', bundle], { stdio: 'inherit' });
  console.log(`Built ${bundle}`);
}

main().catch(error => { console.error(error); process.exitCode = 1; });
