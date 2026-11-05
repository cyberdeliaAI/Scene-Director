'use strict';

const { contextBridge, ipcRenderer } = require('electron');

// One specific native action; the page never receives general IPC or filesystem access.
contextBridge.exposeInMainWorld('sceneDirectorDesktop', {
  choosePresetFolder: (kind, currentPath) => ipcRenderer.invoke('choose-preset-folder', kind, currentPath),
});
