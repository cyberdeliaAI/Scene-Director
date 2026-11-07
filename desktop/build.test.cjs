'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { plainEnvironment, signingEnvironment } = require('./build-utils.cjs');

const sample = { CSC_LINK:'fake-certificate', CSC_KEY_PASSWORD:'fake-password', APPLE_ID:'test@example.invalid',
  APPLE_APP_SPECIFIC_PASSWORD:'fake-app-password', APPLE_TEAM_ID:'ABC1234567', PATH:'/usr/bin', GITHUB_EVENT_NAME:'workflow_dispatch' };
test('ordinary build and runtime environments strip all signing credentials', () => {
  assert.deepEqual(plainEnvironment({...sample,WIN_CSC_LINK:'fake',APPLE_EXTRA:'fake'}),{PATH:'/usr/bin',GITHUB_EVENT_NAME:'workflow_dispatch'});
  assert.equal(sample.CSC_KEY_PASSWORD,'fake-password');
});
test('signed builds fail without all credentials, a valid team, and an explicit build event', () => {
  assert.throws(()=>signingEnvironment({},'darwin'),/Missing signing settings/);
  assert.throws(()=>signingEnvironment(sample,'linux'),/requires macOS/);
  assert.throws(()=>signingEnvironment({...sample,APPLE_TEAM_ID:'bad'},'darwin'),/ten-character/);
  assert.throws(()=>signingEnvironment({...sample,GITHUB_EVENT_NAME:'pull_request'},'darwin'),/explicit trusted/);
  const env=signingEnvironment({...sample,CSC_FOR_PULL_REQUEST:'true'},'darwin');
  assert.equal(env.CSC_FOR_PULL_REQUEST,'false');
  assert.equal(env.CSC_IDENTITY_AUTO_DISCOVERY,'true');
});
test('signed packaging includes the prepared backend before Developer ID signing and notarization', () => {
  const config=require('./electron-signed.cjs');
  assert.equal(config.forceCodeSigning,true);
  assert.equal(config.mac.notarize,true);
  assert.equal(config.mac.hardenedRuntime,true);
  assert.equal(config.mac.type,'distribution');
  assert.ok(config.extraResources.some(item=>item.to==='backend'));
  assert.equal(config.mac.identity,undefined);
});
