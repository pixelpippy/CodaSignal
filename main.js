// main.js
const { app, BrowserWindow, Tray, Menu, ipcMain, nativeImage } = require('electron');
const path = require('node:path');
const zlib = require('node:zlib');

// --- 状态色托盘图标（生成 16x16 圆形 PNG，避免外部资源依赖） ---
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();
function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function pngChunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length, 0);
  const t = Buffer.from(type, 'ascii');
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(Buffer.concat([t, data])), 0);
  return Buffer.concat([len, t, data, crc]);
}
function makeDotPng(rgb) {
  const size = 16;
  const stride = 1 + size * 4;
  const raw = Buffer.alloc(size * stride);
  for (let y = 0; y < size; y++) {
    raw[y * stride] = 0;
    for (let x = 0; x < size; x++) {
      const dx = x - (size - 1) / 2, dy = y - (size - 1) / 2;
      const dist = Math.sqrt(dx * dx + dy * dy);
      const o = y * stride + 1 + x * 4;
      if (dist <= (size - 1) / 2 - 1) {
        raw[o] = rgb[0]; raw[o + 1] = rgb[1]; raw[o + 2] = rgb[2]; raw[o + 3] = 255;
      } else {
        raw[o] = raw[o + 1] = raw[o + 2] = 0; raw[o + 3] = 0;
      }
    }
  }
  const idat = zlib.deflateSync(raw);
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  return Buffer.concat([sig, pngChunk('IHDR', ihdr), pngChunk('IDAT', idat), pngChunk('IEND', Buffer.alloc(0))]);
}
const ICON_COLORS = {
  red: [255, 77, 79], yellow: [255, 217, 59], green: [54, 211, 153], idle: [136, 136, 136],
};
function makeIcon(state) {
  const rgb = ICON_COLORS[state] || ICON_COLORS.idle;
  return nativeImage.createFromDataURL(`data:image/png;base64,${makeDotPng(rgb).toString('base64')}`);
}

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
  if (tray) tray.setImage(makeIcon(appState.state));
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
  tray = new Tray(makeIcon(appState.state));
  const menu = Menu.buildFromTemplate([
    { label: '统计面板', click: () => openStatsWindow() },
    { label: '退出', click: () => app.quit() },
  ]);
  tray.setToolTip('CodaSignal');
  tray.setContextMenu(menu);
  tray.on('click', () => focusTerminal(appState.cwd));
}

ipcMain.on('focus-terminal', () => focusTerminal(appState.cwd));
ipcMain.on('minimize-light', () => { if (lightWin) lightWin.minimize(); });
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
