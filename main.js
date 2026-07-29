// main.js
const { app, BrowserWindow, Tray, Menu, ipcMain, nativeImage } = require('electron');
const path = require('node:path');
const { AppState, projectNameFromCwd } = require('./src/state.js');
const { startServer } = require('./src/server.js');
const { focusTerminal } = require('./src/focus.js');
const {
  findTranscript, sumUsage, estimateCost, loadPrices, loadStats, recordSession, buildRecord,
} = require('./src/stats.js');
const { defaultPort } = require('./src/config.js');

let lightWin = null;
let statsWin = null;
let tray = null;
const appState = new AppState();

function sendState() {
  if (lightWin) lightWin.webContents.send('state-update', appState.snapshot());
}

function createLightWindow() {
  lightWin = new BrowserWindow({
    width: 180, height: 220, frame: false, transparent: true,
    alwaysOnTop: true, resizable: false, skipTaskbar: true,
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false },
  });
  lightWin.loadFile(path.join(__dirname, 'renderer', 'index.html'));
  lightWin.on('closed', () => { lightWin = null; });
}

function computeCurrentTokens() {
  if (!appState.cwd) return null;
  const tp = findTranscript(appState.cwd);
  if (!tp) return null;
  return sumUsage(tp);
}

function currentDurationMs() {
  if (!appState.startTs) return 0;
  const end = appState.endTs || Date.now();
  return Math.max(0, end - appState.startTs);
}

function openStatsWindow() {
  if (statsWin) { statsWin.focus(); return; }
  statsWin = new BrowserWindow({
    width: 520, height: 600, show: true,
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false },
  });
  statsWin.loadFile(path.join(__dirname, 'renderer', 'stats.html'));
  statsWin.on('closed', () => { statsWin = null; });
}

function makeIcon() {
  // 16x16 红色圆点占位图标（base64 PNG），避免外部资源依赖
  const b64 = 'iVBORw0KGgoAAAANSUhEUgAAAAQAAAAECAYAAACp8Z5+AAAAEklEQVR4nGP8z8Dwn4EIwDiqEAByqgQF6R0qgwAAAABJRU5ErkJggg==';
  return nativeImage.createFromDataURL(`data:image/png;base64,${b64}`);
}

function buildTray() {
  tray = new Tray(makeIcon());
  const menu = Menu.buildFromTemplate([
    { label: '统计面板', click: () => openStatsWindow() },
    { label: '退出', click: () => app.quit() },
  ]);
  tray.setToolTip('CodaSignal');
  tray.setContextMenu(menu);
  tray.on('click', () => focusTerminal(appState.cwd));
}

ipcMain.on('focus-terminal', () => focusTerminal(appState.cwd));
ipcMain.handle('get-stats', () => {
  const prices = loadPrices();
  const tokens = computeCurrentTokens();
  const current = tokens
    ? {
        cwd: appState.cwd,
        project: projectNameFromCwd(appState.cwd),
        startTs: appState.startTs,
        endTs: appState.endTs,
        durationMs: currentDurationMs(),
        tokens,
        cost: estimateCost(tokens, prices),
      }
    : null;
  const stored = loadStats();
  return { current, totals: stored.totals, sessions: stored.sessions, prices };
});

app.whenReady().then(async () => {
  createLightWindow();
  buildTray();
  const server = await startServer(defaultPort(), (event, data) => {
    appState.applyEvent(event, data || {});
    // 会话结束时自动落盘一条记录（spec §10），按 (cwd,startTs) 去重，避免重复计数
    if (event === 'SessionEnd' && appState.startTs) {
      const stored = loadStats();
      const dup = stored.sessions.find(
        (s) => s.cwd === appState.cwd && s.startTs === appState.startTs
      );
      if (!dup) {
        const prices = loadPrices();
        const tk = computeCurrentTokens() || { input: 0, output: 0, cacheCreation: 0, cacheRead: 0, total: 0 };
        recordSession(buildRecord({
          sessionId: appState.sessionId, cwd: appState.cwd,
          project: projectNameFromCwd(appState.cwd),
          startTs: appState.startTs, endTs: appState.endTs, tokens: tk,
        }, prices));
      }
    }
    sendState();
  });
  if (!server) {
    console.error('[CodaSignal] 端口被占用，可能已有一个实例在运行，退出。');
    app.quit();
    return;
  }
});

app.on('window-all-closed', () => { /* 保持托盘常驻，不退出 */ });
