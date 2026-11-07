'use strict';

const { app, BrowserWindow, dialog, ipcMain, Menu, net, protocol, session } = require('electron');
const { createPresetFolderPicker } = require('./folder-picker.cjs');
const { allowDatasetDownload } = require('./dataset-download.cjs');
const { spawn } = require('node:child_process');
const { randomBytes } = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const readline = require('node:readline');

const APP_URL = 'scene-director://app/';
protocol.registerSchemesAsPrivileged([{ scheme: 'scene-director', privileges: {
  standard: true, secure: true, supportFetchAPI: true, corsEnabled: true,
} }]);
app.setName('Scene Director');
if (process.env.SCENE_DIRECTOR_DESKTOP_DATA_DIR) {
  app.setPath('userData', path.resolve(process.env.SCENE_DIRECTOR_DESKTOP_DATA_DIR));
} else {
  app.setPath('userData', path.join(app.getPath('appData'), 'Scene Director'));
}

let window;
let backend;
let backendURL;
let quitting = false;
let stopped = false;
let log;
const token = randomBytes(32).toString('hex');
const dataDir = app.getPath('userData');

function report(message) {
  log?.write(`${new Date().toISOString()} ${message}\n`);
}

function startBackend() {
  return new Promise((resolve, reject) => {
    const bundled = path.join(process.resourcesPath, 'backend', 'scene-director-backend');
    const command = app.isPackaged ? bundled : path.join(__dirname, '.venv', 'bin', 'python');
    const args = app.isPackaged ? [] : ['-u', path.join(__dirname, '..', 'scene_director_desktop.py')];
    backend = spawn(command, args, {
      cwd: dataDir,
      stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env, PYTHONUTF8: '1', PYTHONIOENCODING: 'utf-8',
        SCENE_DIRECTOR_DESKTOP_TOKEN: token, SCENE_DIRECTOR_DESKTOP_DATA_DIR: dataDir },
    });
    const timer = setTimeout(() => reject(new Error('The local app service took too long to start.')), 30000);
    const lines = readline.createInterface({ input: backend.stdout });
    lines.on('line', line => {
      try {
        const event = JSON.parse(line);
        if (event.type === 'ready' && Number.isInteger(event.port) && event.port > 0 && event.port < 65536) {
          clearTimeout(timer);
          backendURL = `http://127.0.0.1:${event.port}`;
          report(`Local service ready (${event.version}).`);
          resolve();
        }
      } catch { report('Unexpected local service output.'); }
    });
    // Never log request bodies, uploaded images, or API keys.
    backend.stderr.on('data', () => report('The local service reported a diagnostic on stderr.'));
    backend.once('error', error => { clearTimeout(timer); reject(error); });
    backend.once('exit', (code, signal) => {
      clearTimeout(timer);
      report(`Local service exited (${code ?? signal}).`);
      if (!backendURL) reject(new Error('The local app service could not start.'));
      else if (!quitting) {
        dialog.showErrorBox('Scene Director stopped', 'The local app service stopped. Quit and reopen Scene Director. Your saved prompts are kept.');
        app.quit();
      }
    });
  });
}

function isAppPage(url) {
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'scene-director:' && parsed.hostname === 'app' &&
      !parsed.port && !parsed.username && !parsed.password && parsed.pathname === '/' && !parsed.search;
  } catch { return false; }
}

async function installProtocol() {
  const localSession = session.fromPartition('persist:scene-director');
  localSession.setPermissionRequestHandler((_webContents, _permission, callback) => callback(false));
  localSession.setPermissionCheckHandler(() => false);
  localSession.setDevicePermissionHandler(() => false);
  localSession.on('will-download', (event, item, contents) => {
    if (!allowDatasetDownload(item, contents, window, isAppPage)) { event.preventDefault(); return; }
    item.setSaveDialogOptions({ title: 'Save dataset export', defaultPath: path.join(app.getPath('downloads'), item.getFilename()), buttonLabel: 'Save' });
  });
  await localSession.protocol.handle('scene-director', async request => {
    const url = new URL(request.url);
    if (url.hostname !== 'app' || url.port || url.username || url.password ||
        !['GET', 'POST'].includes(request.method)) return new Response('Forbidden', { status: 403 });
    try {
      const headers = { 'X-Scene-Director-Token': token };
      const options = { method: request.method, headers, redirect: 'error' };
      if (request.method === 'POST') {
        if (!url.pathname.startsWith('/api/')) return new Response('Forbidden', { status: 403 });
        headers['Content-Type'] = 'application/json';
        options.body = Buffer.from(await request.arrayBuffer());
      }
      return await net.fetch(backendURL + url.pathname + url.search, options);
    } catch {
      return Response.json({ ok: false, error: 'The local app service is unavailable. Quit and reopen Scene Director.' }, { status: 503 });
    }
  });
  return localSession;
}

function createWindow(localSession) {
  window = new BrowserWindow({
    width: 1400, height: 940, minWidth: 860, minHeight: 640,
    title: 'Scene Director', backgroundColor: '#1c1f26', show: false,
    webPreferences: { session: localSession, preload: path.join(__dirname, 'preload.cjs'), nodeIntegration: false,
      contextIsolation: true, sandbox: true, webSecurity: true, webviewTag: false,
      devTools: !app.isPackaged, navigateOnDragDrop: false },
  });
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  window.webContents.on('will-navigate', (event, url) => { if (!isAppPage(url)) event.preventDefault(); });
  window.webContents.on('will-redirect', (event, url) => { if (!isAppPage(url)) event.preventDefault(); });
  window.webContents.on('will-attach-webview', event => event.preventDefault());
  window.webContents.on('render-process-gone', () => {
    if (!quitting) { dialog.showErrorBox('Scene Director needs to reopen', 'The app window stopped. Quit and reopen Scene Director.'); app.quit(); }
  });
  window.once('ready-to-show', () => { report('App window ready.'); window.show(); });
  window.once('closed', () => { window = null; });
  window.loadURL(APP_URL).catch(() => {
    if (!quitting) { dialog.showErrorBox('Could not open Scene Director', 'The app interface could not load. Please reopen the app.'); app.quit(); }
  });
}

Menu.setApplicationMenu(Menu.buildFromTemplate([
  { label: 'Scene Director', submenu: [{ role: 'about' }, { type: 'separator' },
    { role: 'hide' }, { role: 'hideOthers' }, { role: 'unhide' }, { type: 'separator' }, { role: 'quit' }] },
  { role: 'editMenu' },
  { label: 'View', submenu: [{ role: 'resetZoom' }, { role: 'zoomIn' }, { role: 'zoomOut' },
    { type: 'separator' }, { role: 'togglefullscreen' }] },
  { role: 'windowMenu' },
]));
app.setAboutPanelOptions({ applicationName: 'Scene Director', applicationVersion: app.getVersion(),
  version: 'Apple Silicon test', copyright: 'Prompt writing for Krea 2 and Z-Image Turbo' });

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => { if (window) { if (window.isMinimized()) window.restore(); window.show(); window.focus(); } });
  app.on('activate', () => { if (window) { window.show(); window.focus(); } });
  app.on('window-all-closed', () => app.quit());
  app.on('before-quit', event => {
    if (stopped) return;
    if (quitting) { event.preventDefault(); return; }
    quitting = true;
    if (!backend || backend.exitCode !== null || backend.signalCode !== null) { stopped = true; return; }
    event.preventDefault();
    // EOF stops the service and its current worker; SIGKILL is only a timeout fallback.
    backend.stdin.end();
    const timer = setTimeout(() => backend.kill('SIGKILL'), 5000);
    backend.once('exit', () => { clearTimeout(timer); stopped = true; log?.end(); app.quit(); });
  });
  app.whenReady().then(async () => {
    fs.mkdirSync(dataDir, { recursive: true, mode: 0o700 });
    const logPath = path.join(dataDir, 'desktop.log');
    if (fs.existsSync(logPath) && fs.statSync(logPath).size > 1024 * 1024) fs.truncateSync(logPath);
    log = fs.createWriteStream(logPath, { flags: 'a', mode: 0o600 });
    ipcMain.handle('choose-preset-folder', createPresetFolderPicker({
      dialog, getWindow: () => window, isAppPage,
      documentsPath: app.getPath('documents'), homePath: app.getPath('home'),
    }));
    await startBackend();
    createWindow(await installProtocol());
  }).catch(error => {
    report(`Startup failed: ${error.message}`);
    dialog.showErrorBox('Could not start Scene Director', `${error.message}\n\nPlease reopen the app. Diagnostic log: ${path.join(dataDir, 'desktop.log')}`);
    app.quit();
  });
}
