'use strict';

const path = require('node:path');

function createPresetFolderPicker({ dialog, getWindow, isAppPage, documentsPath, homePath }) {
  let pending = false;
  return async (event, kind, currentPath = '') => {
    const window = getWindow();
    if (!window || window.isDestroyed() || event.sender !== window.webContents ||
        !event.senderFrame || event.senderFrame !== window.webContents.mainFrame ||
        !isAppPage(event.senderFrame.url)) throw new Error('Folder picker unavailable for this page.');
    if (!['text', 'vision'].includes(kind) || typeof currentPath !== 'string' ||
        currentPath.length > 4096 || currentPath.includes('\0')) throw new Error('Invalid preset folder selection.');
    if (pending) return null;
    pending = true;
    try {
      let hint = currentPath.trim();
      if (hint === '~' || hint.startsWith('~/')) hint = path.join(homePath, hint.slice(2));
      const result = await dialog.showOpenDialog(window, {
        title: kind === 'vision' ? 'Choose Vision preset folder' : 'Choose text preset folder',
        message: 'Select the folder containing your .txt system-prompt presets.',
        buttonLabel: 'Choose folder', properties: ['openDirectory'],
        defaultPath: path.isAbsolute(hint) ? hint : documentsPath,
      });
      return result.canceled || result.filePaths.length !== 1 ? null : result.filePaths[0];
    } finally { pending = false; }
  };
}

module.exports = { createPresetFolderPicker };
