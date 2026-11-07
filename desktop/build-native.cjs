'use strict';

const { packager } = require('@electron/packager');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const { plainEnvironment } = require('./build-utils.cjs');

async function main() {
  if (!['darwin', 'win32', 'linux'].includes(process.platform) || !['arm64', 'x64'].includes(process.arch)) {
    throw new Error('Build on a supported native 64-bit platform.');
  }
  const python = path.join(__dirname, '.venv', process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python');
  const root = path.resolve(__dirname, '..');
  const build = path.join(__dirname, 'build');
  const stage = path.join(build, 'electron-source');
  fs.mkdirSync(stage, { recursive: true });
  fs.copyFileSync(path.join(root, 'web/app-icon.png'), path.join(stage, 'app-icon.png'));
  for (const file of ['main.cjs', 'preload.cjs', 'folder-picker.cjs', 'dataset-download.cjs', 'package.json']) fs.copyFileSync(path.join(__dirname, file), path.join(stage, file));
  fs.mkdirSync(path.join(build, 'spec'), { recursive: true });
  execFileSync(python, [
    '-m', 'PyInstaller', '--noconfirm', '--clean', '--onedir', ...(process.platform === 'darwin' ? ['--target-architecture', process.arch === 'x64' ? 'x86_64' : 'arm64'] : []),
    '--name', 'scene-director-backend', '--distpath', path.join(build, 'python-dist'),
    '--workpath', path.join(build, 'python-work'), '--specpath', path.join(build, 'spec'),
    '--add-data', `${path.join(root, 'web')}${path.delimiter}web`,
    '--add-data', `${execFileSync(python, ['-c', 'import certifi; print(certifi.where())'], { encoding:'utf8', env:plainEnvironment() }).trim()}${path.delimiter}certificates`,
    '--runtime-hook', path.join(__dirname, 'certificates.py'), path.join(root, 'scene_director_desktop.py'),
  ], { cwd: root, stdio: 'inherit', env: { ...plainEnvironment(), PYINSTALLER_CONFIG_DIR: path.join(build, 'pyinstaller-cache') } });
  const licenses = JSON.parse(execFileSync(python, [path.join(__dirname, 'license_paths.py')],
    { encoding:'utf8', env:plainEnvironment() }));
  fs.mkdirSync(path.join(build, 'licenses'), { recursive:true });
  for (const [name, source] of Object.entries(licenses)) {
    if (!fs.existsSync(source)) throw new Error('Missing bundled license: '+name);
    fs.copyFileSync(source, path.join(build, 'licenses', name));
  }
  for (const name of ['LICENSE', 'LICENSES.chromium.html']) {
    const source = path.join(__dirname, 'node_modules/electron/dist', name);
    if (!fs.existsSync(source)) throw new Error('Install the pinned Electron binary before building.');
    fs.copyFileSync(source, path.join(build, 'licenses', name === 'LICENSE' ? 'Electron-LICENSE.txt' : name));
  }
  if (process.argv.includes('--prepare')) { console.log('Prepared the backend and desktop source.'); return; }
  const version = require('./package.json').version;
  const outputs = await packager({
    dir: stage, name: 'Scene Director', executableName:process.platform === 'linux' ? 'scene-director' : 'Scene Director', platform: process.platform, arch: process.arch,
    icon: path.join(__dirname, 'assets', process.platform === 'win32' ? 'SceneDirector.ico' : process.platform === 'darwin' ? 'SceneDirector.icns' : 'SceneDirector.png'),
    electronVersion: require('./package.json').devDependencies.electron,
    out: path.join(__dirname, 'dist', version), overwrite: true, asar: true,
    appBundleId: 'com.scenedirector.desktop.test', appVersion: version, buildVersion: version.split('-')[0],
    appCopyright: 'Scene Director',
    extendInfo: { LSMinimumSystemVersion: '13.0', NSHighResolutionCapable: true,
      NSHumanReadableCopyright: 'Scene Director',
      NSLocalNetworkUsageDescription: 'Connect to your local language model server.' },
  });
  const bundle = process.platform === 'darwin' ? path.join(outputs[0], 'Scene Director.app') : outputs[0];
  const resources = process.platform === 'darwin' ? path.join(bundle, 'Contents/Resources') : path.join(bundle, 'resources');
  fs.cpSync(path.join(build, 'python-dist', 'scene-director-backend'), path.join(resources, 'backend'),
    { recursive:true, verbatimSymlinks:true });
  fs.cpSync(path.join(build, 'licenses'), path.join(resources, 'licenses'), { recursive:true });
  if (process.platform === 'darwin') {
    // Local builds remain ad-hoc signed; release builds use the explicit signed recipe.
    execFileSync('/usr/bin/codesign', ['--force', '--deep', '--sign', '-', bundle], { stdio:'inherit' });
    execFileSync('/usr/bin/codesign', ['--verify', '--deep', '--strict', bundle], { stdio:'inherit' });
  }
  console.log(`Built ${bundle}`);
}

main().catch(error => { console.error(error); process.exitCode = 1; });
