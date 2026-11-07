'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { SIGNING_KEYS, signingEnvironment } = require('./build-utils.cjs');

async function main() {
  const env = signingEnvironment();
  if (process.arch !== 'arm64') throw new Error('This test build requires Apple Silicon.');
  if (!fs.existsSync(path.join(__dirname, 'build/electron-source/package.json')) ||
      !fs.existsSync(path.join(__dirname, 'build/python-dist/scene-director-backend/scene-director-backend'))) {
    throw new Error('Run npm run prepare:mac before signing.');
  }
  for (const key of Object.keys(process.env)) if (/^(?:APPLE_|CSC_|WIN_CSC_)/.test(key)) delete process.env[key];
  Object.assign(process.env, env);
  const { build, Platform, Arch } = require('electron-builder');
  await build({ projectDir:path.join(__dirname, 'build/electron-source'),
    config:require('./electron-signed.cjs'), targets:Platform.MAC.createTarget('dir', Arch.arm64), publish:'never' });
  console.log('Developer ID signing and notarization finished. Final archive verification is still required.');
}
main().catch(error => {
  let message = String(error.message || 'Unknown signing failure');
  for (const key of SIGNING_KEYS) if (process.env[key]) message = message.split(process.env[key]).join('[redacted]');
  console.error('Signed Mac build failed: ' + message); process.exitCode = 1;
});
