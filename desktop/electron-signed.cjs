'use strict';
const path = require('node:path');
const meta = require('./package.json');
module.exports = {
  appId: 'com.scenedirector.desktop.test', productName: 'Scene Director',
  electronVersion: meta.devDependencies.electron, buildVersion: '3.9.0.1',
  electronDist:path.join(__dirname, 'node_modules/electron/dist'),
  copyright: 'Scene Director', asar: true, forceCodeSigning: true,
  npmRebuild: false, nodeGypRebuild: false,
  directories: { output:path.join(__dirname, 'dist', meta.version, 'signed') },
  files: ['main.cjs', 'preload.cjs', 'folder-picker.cjs', 'dataset-download.cjs', 'package.json'],
  extraResources: [
    { from:path.join(__dirname, 'build/python-dist/scene-director-backend'), to:'backend' },
    { from:path.join(__dirname, 'build/licenses'), to:'licenses' },
  ],
  mac: {
    target: ['dir'], icon:path.join(__dirname, 'assets/SceneDirector.icns'),
    category:'public.app-category.photography', type:'distribution', minimumSystemVersion:'13.0',
    hardenedRuntime:true, entitlements:path.join(__dirname, 'entitlements.mac.plist'),
    entitlementsInherit:path.join(__dirname, 'entitlements.mac.plist'), notarize:true,
    extendInfo: { NSLocalNetworkUsageDescription:'Connect to your local language model server.' },
  },
};
