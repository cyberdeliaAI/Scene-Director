'use strict';

const SIGNING_KEYS = ['CSC_LINK', 'CSC_KEY_PASSWORD', 'APPLE_ID', 'APPLE_APP_SPECIFIC_PASSWORD', 'APPLE_TEAM_ID'];
function plainEnvironment(source = process.env) {
  return Object.fromEntries(Object.entries(source).filter(([key]) => !/^(?:APPLE_|CSC_|WIN_CSC_)/.test(key)));
}
function signingEnvironment(source = process.env, platform = process.platform) {
  if (platform !== 'darwin') throw new Error('Apple signing requires macOS.');
  const missing = SIGNING_KEYS.filter(key => !source[key]);
  if (missing.length) throw new Error('Missing signing settings: ' + missing.join(', '));
  if (!/^[A-Z0-9]{10}$/.test(source.APPLE_TEAM_ID)) throw new Error('APPLE_TEAM_ID must be a ten-character team identifier.');
  if (source.GITHUB_EVENT_NAME && !['push', 'workflow_dispatch'].includes(source.GITHUB_EVENT_NAME)) throw new Error('Signing requires an explicit trusted test build.');
  return { ...plainEnvironment(source), ...Object.fromEntries(SIGNING_KEYS.map(key => [key, source[key]])),
    CSC_IDENTITY_AUTO_DISCOVERY: 'true', CSC_FOR_PULL_REQUEST: 'false' };
}
module.exports = { SIGNING_KEYS, plainEnvironment, signingEnvironment };
