'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { describeDiagnostic } = require('./diagnostic.cjs');

test('copies only the service diagnostic shape into the log', () => {
  assert.equal(describeDiagnostic('Scene Director diagnostic: KeyError at scene_director_web.py:812'),
    'Local service error: KeyError at scene_director_web.py:812.');
  assert.equal(describeDiagnostic('Scene Director diagnostic: JSONDecodeError at unknown\r'),
    'Local service error: JSONDecodeError at unknown.');
});

test('never copies other stderr text', () => {
  for (const line of ['Traceback (most recent call last):', 'api_key=sk-secret',
    'Scene Director diagnostic: KeyError at scene_director_web.py:812 sk-secret',
    'Scene Director diagnostic: Key Error at x.py:1', 'Scene Director diagnostic: KeyError at ../../etc/passwd:1']) {
    assert.equal(describeDiagnostic(line), 'The local service reported a diagnostic on stderr.');
  }
});
