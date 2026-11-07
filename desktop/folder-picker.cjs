'use strict';

const path = require('node:path');

// Each kind is one fixed dialog. The page cannot pass dialog options of its own.
const KINDS = {
  text: { title: 'Choose text preset folder', message: 'Select the folder containing your .txt system-prompt presets.', properties: ['openDirectory'] },
  vision: { title: 'Choose Vision preset folder', message: 'Select the folder containing your .txt system-prompt presets.', properties: ['openDirectory'] },
  dataset: { title: 'Choose dataset export folder', message: 'Select the folder where prepared images and captions are written.', properties: ['openDirectory', 'createDirectory'], buttonLabel: 'Choose folder' },
  workflow: { title: 'Choose ComfyUI API workflow', message: 'Select a workflow saved with Export (API) in ComfyUI.', properties: ['openFile'],
    filters: [{ name: 'ComfyUI API workflow', extensions: ['json'] }], buttonLabel: 'Choose workflow' },
};

function createPresetFolderPicker({ dialog, getWindow, isAppPage, documentsPath, homePath }) {
  let pending = false;
  return async (event, kind, currentPath = '') => {
    const window = getWindow();
    if (!window || window.isDestroyed() || event.sender !== window.webContents ||
        !event.senderFrame || event.senderFrame !== window.webContents.mainFrame ||
        !isAppPage(event.senderFrame.url)) throw new Error('Folder picker unavailable for this page.');
    if (!Object.hasOwn(KINDS, kind) || typeof currentPath !== 'string' ||
        currentPath.length > 4096 || currentPath.includes('\0')) throw new Error('Invalid preset folder selection.');
    if (pending) return null;
    pending = true;
    try {
      let hint = currentPath.trim();
      if (hint === '~' || hint.startsWith('~/')) hint = path.join(homePath, hint.slice(2));
      const { title, message, properties, filters, buttonLabel = 'Choose folder' } = KINDS[kind];
      const result = await dialog.showOpenDialog(window, {
        title, message, buttonLabel, properties, ...(filters ? { filters } : {}),
        defaultPath: path.isAbsolute(hint) ? hint : documentsPath,
      });
      return result.canceled || result.filePaths.length !== 1 ? null : result.filePaths[0];
    } finally { pending = false; }
  };
}

module.exports = { createPresetFolderPicker };
