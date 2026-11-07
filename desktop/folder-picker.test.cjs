'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createPresetFolderPicker } = require('./folder-picker.cjs');

function fixture(showOpenDialog = async () => ({ canceled: false, filePaths: ['/shared/presets'] })) {
  const frame = { url: 'scene-director://app/' };
  const window = { isDestroyed: () => false, webContents: { mainFrame: frame } };
  const calls = [];
  const choose = createPresetFolderPicker({
    dialog: { showOpenDialog: async (...args) => { calls.push(args); return showOpenDialog(...args); } },
    getWindow: () => window, isAppPage: url => url === 'scene-director://app/',
    documentsPath: '/Users/test/Documents', homePath: '/Users/test',
  });
  return { choose, window, calls, event: { sender: window.webContents, senderFrame: frame } };
}

test('trusted page receives one chosen folder from a directory-only dialog', async () => {
  const f = fixture();
  assert.equal(await f.choose(f.event, 'text', '/existing/presets'), '/shared/presets');
  const [owner, options] = f.calls[0];
  assert.equal(owner, f.window);
  assert.deepEqual(options.properties, ['openDirectory']);
  assert.equal(options.defaultPath, '/existing/presets');
  assert.equal(options.title, 'Choose text preset folder');
});

test('cancel returns no replacement path', async () => {
  const f = fixture(async () => ({ canceled: true, filePaths: [] }));
  assert.equal(await f.choose(f.event, 'vision'), null);
  assert.equal(f.calls[0][1].title, 'Choose Vision preset folder');
});

test('foreign windows, subframes and other pages cannot open the picker', async () => {
  const f = fixture();
  for (const event of [{ ...f.event, sender: {} }, { ...f.event, senderFrame: { url: 'scene-director://app/' } },
                        { ...f.event, senderFrame: null }]) {
    await assert.rejects(f.choose(event, 'text'), /unavailable/);
  }
  f.event.senderFrame.url = 'https://example.com/';
  await assert.rejects(f.choose(f.event, 'text'), /unavailable/);
  assert.equal(f.calls.length, 0);
});

test('dataset folders and ComfyUI workflow files use their own fixed dialogs', async () => {
  const calls = [];
  const window = { isDestroyed: () => false, webContents: {} };
  window.webContents.mainFrame = { url: 'scene-director://app/' };
  const choose = createPresetFolderPicker({ dialog: { showOpenDialog: async (_w, options) => { calls.push(options); return { canceled: false, filePaths: ['/x'] }; } },
    getWindow: () => window, isAppPage: url => url === 'scene-director://app/', documentsPath: '/docs', homePath: '/home' });
  const event = { sender: window.webContents, senderFrame: window.webContents.mainFrame };
  assert.equal(await choose(event, 'dataset', ''), '/x');
  assert.deepEqual(calls[0].properties, ['openDirectory', 'createDirectory']);
  assert.equal(await choose(event, 'workflow', ''), '/x');
  assert.deepEqual(calls[1].properties, ['openFile']);
  assert.deepEqual(calls[1].filters[0].extensions, ['json']);
  await assert.rejects(choose(event, '__proto__', ''), /Invalid/);
});
test('invalid kinds and path values are refused before displaying a dialog', async () => {
  const f = fixture();
  for (const [kind, value] of [['other', ''], ['text', {}], ['vision', 'x'.repeat(4097)], ['text', 'bad\0path']]) {
    await assert.rejects(f.choose(f.event, kind, value), /Invalid/);
  }
  assert.equal(f.calls.length, 0);
});

test('home paths expand and empty paths start in Documents', async () => {
  const f = fixture();
  await f.choose(f.event, 'text', '~/presets');
  await f.choose(f.event, 'vision', '');
  assert.equal(f.calls[0][1].defaultPath, '/Users/test/presets');
  assert.equal(f.calls[1][1].defaultPath, '/Users/test/Documents');
});

test('duplicate requests cannot open concurrent dialogs and errors allow a later retry', async () => {
  let release;
  const f = fixture(() => new Promise(resolve => { release = resolve; }));
  const first = f.choose(f.event, 'text');
  assert.equal(await f.choose(f.event, 'vision'), null);
  release({ canceled: true, filePaths: [] });
  await first;
  assert.equal(f.calls.length, 1);
  let fail = true;
  const g = fixture(async () => { if (fail) throw new Error('native error'); return { canceled: true, filePaths: [] }; });
  await assert.rejects(g.choose(g.event, 'text'), /native error/);
  fail = false;
  assert.equal(await g.choose(g.event, 'text'), null);
});
