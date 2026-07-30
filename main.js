// main.js
const { app, BrowserWindow, Tray, Menu, ipcMain, nativeImage, screen } = require('electron');
const path = require('node:path');
const fs = require('node:fs');
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
  findTranscript, sumUsage, estimateCost, loadPrices, loadStats, upsertSession, buildRecord,
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
    width: 110, height: 300, frame: false, transparent: false,
    backgroundColor: '#1c1c1e',
    alwaysOnTop: true, resizable: false, skipTaskbar: true,
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false },
  });
  lightWin.loadFile(path.join(__dirname, 'renderer', 'index.html'));
  // 硬锁尺寸，避免 transparent 无边框窗口在极端情况下被 Windows 缩放
  lightWin.setResizable(false);
  lightWin.setMinimumSize(110, 300);
  lightWin.setMaximumSize(110, 300);
  lightWin.setMaximizable(false);
  // 关闭系统级 DWM 阴影：透明无边框窗口在 Windows 上会把原生阴影渲染成
  // 一块硬边直角暗色矩形（即用户看到的“窗口下的第二层”）。视觉阴影改由 CSS box-shadow 提供。
  lightWin.setHasShadow(false);
  // 不透明无边框窗口尝试用系统圆角（避免透明背景透出黑底形成“第二层”）；
  // 本机 Electron 31.7.7 无 setRoundedCorners，guard 后无副作用。
  if (typeof lightWin.setRoundedCorners === 'function') lightWin.setRoundedCorners(true);
  lightWin.on('closed', () => { lightWin = null; });
}

function showLightWindow() {
  if (!lightWin) { createLightWindow(); return; }
  if (lightWin.isMinimized()) lightWin.restore();
  lightWin.show();
  lightWin.focus();
}

function computeCurrentTokens() {
  // 优先用 SessionStart 直接给的 transcript_path（精确、无需 slug 猜测、避开大小写坑）
  if (appState.transcriptPath && fs.existsSync(appState.transcriptPath)) {
    return sumUsage(appState.transcriptPath);
  }
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
    { label: '显示悬浮窗', click: () => showLightWindow() },
    { label: '统计面板', click: () => openStatsWindow() },
    { label: '退出', click: () => app.quit() },
  ]);
  tray.setToolTip('CodaSignal');
  tray.setContextMenu(menu);
  tray.on('click', () => showLightWindow());
}

ipcMain.on('focus-terminal', () => focusTerminal(appState.cwd));
ipcMain.on('minimize-light', () => { if (lightWin) lightWin.minimize(); });
let hoverWin = null;
function createHoverWindow() {
  hoverWin = new BrowserWindow({
    width: 200, height: 190, frame: false, transparent: false,
    backgroundColor: '#1c1c1e',
    alwaysOnTop: true, resizable: false, skipTaskbar: true,
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false },
  });
  hoverWin.loadFile(path.join(__dirname, 'renderer', 'hover.html'));
  hoverWin.setHasShadow(false);
  hoverWin.on('closed', () => { hoverWin = null; });
  hoverWin.on('blur', () => hideHoverStats());
}
function showHoverStats(data) {
  if (!hoverWin) createHoverWindow();
  const lb = lightWin ? lightWin.getBounds() : { x: 0, y: 0, width: 0, height: 0 };
  const w = 220, h = 210, gap = 10;
  const area = screen.getDisplayNearestPoint({ x: lb.x, y: lb.y }).workArea;
  let x = lb.x + lb.width + gap; // 默认右侧
  if (x + w > area.x + area.width) x = lb.x - gap - w; // 右侧放不下 -> 左侧
  hoverWin.setBounds({ x: Math.round(x), y: Math.round(lb.y), width: w, height: h });
  hoverWin.webContents.send('hover-stats', data);
  hoverWin.show();
}
let hoverHideTimer = null;
function cancelHoverHide() { if (hoverHideTimer) { clearTimeout(hoverHideTimer); hoverHideTimer = null; } }
function hideHoverStats() {
  cancelHoverHide();
  hoverHideTimer = setTimeout(() => { if (hoverWin) hoverWin.hide(); }, 200);
}
ipcMain.on('show-hover-stats', (_e, data) => { cancelHoverHide(); showHoverStats(data); });
ipcMain.on('hide-hover-stats', () => hideHoverStats());
ipcMain.on('hover-enter', () => cancelHoverHide());
ipcMain.on('hover-leave', () => hideHoverStats());
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
    // 每轮结束(Stop)与整段会话结束(SessionEnd)都 upsert 一条记录（按 cwd+startTs 去重更新），
    // 这样中途即可看到累计，不再只等 SessionEnd 才落盘。
    if ((event === 'Stop' || event === 'SessionEnd') && appState.startTs) {
      const prices = loadPrices();
      const tk = computeCurrentTokens() || { input: 0, output: 0, cacheCreation: 0, cacheRead: 0, total: 0 };
      upsertSession(buildRecord({
        sessionId: appState.sessionId, cwd: appState.cwd,
        project: projectNameFromCwd(appState.cwd),
        startTs: appState.startTs, endTs: appState.endTs, tokens: tk,
      }, prices));
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
