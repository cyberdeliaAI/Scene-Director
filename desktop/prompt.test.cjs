'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const P = require('../web/prompt-core.js');

test('new versions pin the selected slot for both live and historical parameter formats', () => {
  const parameters = { framing:'close-up | medium | full body', light:'day | night', setting:'indoors' };
  for (const source of [parameters, Object.entries(parameters).map(([name,value]) => ({name,value}))]) {
    const request = {parameters:source, output_prefix:'my_token', count:3, api_url:'http://localhost:1234/v1'};
    const before = JSON.stringify(request);
    const replacement = P.regenerationRequest(request, 2, undefined, ['Earlier scene']);
    assert.deepEqual(replacement.parameters, {framing:'full body', light:'day', setting:'indoors'});
    assert.equal(replacement.count, 1);
    assert.equal(replacement.save_output, false);
    assert.equal(replacement.output_prefix, 'my_token');
    assert.deepEqual(replacement.previous_scenes, ['Earlier scene']);
    assert.equal(JSON.stringify(request), before);
  }
});

test('deleting an earlier prompt does not reassign the surviving prompt’s rotating choices', () => {
  const request = {parameters:{framing:'close-up | medium | full body'}};
  const choices = Array.from({length:3}, (_,index) => P.rotatingChoices(request.parameters,index));
  choices.splice(1,1);
  const replacement = P.regenerationRequest(request, 1, choices[1], []);
  assert.deepEqual(replacement.parameters, {framing:'full body'});
  assert.deepEqual(P.regenerationRequest(request, 1, choices[1], []).parameters, replacement.parameters);
});

test('a regenerated choice remains fixed while the other values keep their literal syntax', () => {
  const request = {parameters:{framing:'close-up | medium | full body', lens:'35mm', note:'one | '}};
  const replacement = P.regenerationRequest(request, 2, {framing:'full body'}, []);
  assert.deepEqual(P.rotatingChoices(replacement.parameters,0), {});
  assert.deepEqual(replacement.parameters, {framing:'full body',lens:'35mm',note:'one | '});
});
