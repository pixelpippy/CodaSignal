// main.js
const { app, BrowserWindow, Tray, Menu, ipcMain, shell } = require('electron');
const path = require('node:path');
const { AppState, projectNameFromCwd } = require('./src/state.js');
const { startServer } = require('./src/server.js');
const { focusTerminal } = require('./src/focus.js');
const {
  findTranscript, sumUsage, estimateCost, loadPrices, loadStats, recordSession, buildRecord,
} = require('./src/stats.js');
const { defaultPort, SIGNAL_DIR } = require('./src/config.js');

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

function buildTray() {
  tray = new Tray(require('electron').nativeImage.createEmpty()); // 占位；详见 Task 8 替换为真实图标
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
  // 若本次会话已结束，确保落盘一条记录
  if (appState.endTs && appState.startTs && !appState._recorded) {
    recordSession(buildRecord({
      sessionId: appState.sessionId, cwd: appState.cwd, project: projectNameFromCwd(appState.cwd),
      startTs: appState.startTs, endTs: appState.endTs, tokens: tokens || { input:0,output:0,cacheCreation:0,cacheRead:0,total:0 },
    }, prices));
    appState._recorded = true;
  }
  return { current, totals: stored.totals, sessions: stored.sessions, prices };
});

app.whenReady().then(async () => {
  createLightWindow();
  buildTray();
  const server = await startServer(defaultPort(), (event, data) => {
    appState.applyEvent(event, data || {});
    if (event === 'SessionEnd') appState._recorded = false; // 允许下次 get-stats 落盘
    sendState();
  });
  if (!server) { app.quit(); return; }
  // 端口冲突时 startServer 返回 undefined → 退出避免多实例
  if (server.listening === false) { app.quit(); }
});

app.on('window-all-closed', () => { /* 保持托盘常驻，不退出 */ });
