// src/stats.js
const fs = require('node:fs');
const path = require('node:path');
const { PROJECTS_DIR, SIGNAL_DIR } = require('./config.js');

const DEFAULT_PRICES = {
  input_per_1m: 3.0,
  output_per_1m: 15.0,
  cache_creation_per_1m: 3.75,
  cache_read_per_1m: 0.3,
  currency: 'USD',
};

function cwdToSlug(cwd) {
  return String(cwd)
    .toLowerCase()
    .replace(/:/g, '')
    .replace(/[\\/]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function findTranscript(cwd, projectsDir = PROJECTS_DIR) {
  if (!cwd) return null;
  // 同一个 cwd 在不同来源下斜杠/盘符写法不一（D:\x / D:/x / /d/x），
  // cwdToSlug 已统一，但再试几种变体以提高命中率。
  const variants = [
    cwdToSlug(cwd),
    cwdToSlug(String(cwd).replace(/\\/g, '/')),
    cwdToSlug(String(cwd).replace(/\\/g, '/').replace(/^([a-z]):/i, '-$1')),
  ];
  for (const slug of variants) {
    const dir = path.join(projectsDir, slug);
    if (!fs.existsSync(dir)) continue;
    const files = fs.readdirSync(dir)
      .filter((f) => f.endsWith('.jsonl'))
      .map((f) => ({ f, m: fs.statSync(path.join(dir, f)).mtimeMs }))
      .sort((a, b) => b.m - a.m);
    if (files.length) return path.join(dir, files[0].f);
  }
  return null;
}

function extractUsage(o) {
  if (!o || typeof o !== 'object') return null;
  if (o.usage && typeof o.usage === 'object') return o.usage;
  if (o.message && o.message.usage && typeof o.message.usage === 'object') return o.message.usage;
  return null;
}

function sumUsage(transcriptPath) {
  const acc = { input: 0, output: 0, cacheCreation: 0, cacheRead: 0, total: 0 };
  const text = fs.readFileSync(transcriptPath, 'utf8');
  for (const line of text.split('\n')) {
    if (!line.trim()) continue;
    let o;
    try { o = JSON.parse(line); } catch { continue; }
    const u = extractUsage(o);
    if (!u) continue;
    acc.input += u.input_tokens || 0;
    acc.output += u.output_tokens || 0;
    acc.cacheCreation += u.cache_creation_input_tokens || 0;
    acc.cacheRead += u.cache_read_input_tokens || 0;
  }
  acc.total = acc.input + acc.output + acc.cacheCreation + acc.cacheRead;
  return acc;
}

function estimateCost(tokens, prices = DEFAULT_PRICES) {
  const p = { ...DEFAULT_PRICES, ...prices };
  return (
    (tokens.input / 1e6) * p.input_per_1m +
    (tokens.output / 1e6) * p.output_per_1m +
    (tokens.cacheCreation / 1e6) * p.cache_creation_per_1m +
    (tokens.cacheRead / 1e6) * p.cache_read_per_1m
  );
}

function loadPrices(settingsDir = SIGNAL_DIR) {
  try {
    const s = JSON.parse(fs.readFileSync(path.join(settingsDir, 'settings.json'), 'utf8'));
    return { ...DEFAULT_PRICES, ...(s.prices || {}) };
  } catch {
    return { ...DEFAULT_PRICES };
  }
}

function buildRecord({ sessionId, cwd, project, startTs, endTs, tokens }, prices) {
  const p = prices || loadPrices();
  const durationMs = (typeof endTs === 'number' && typeof startTs === 'number') ? Math.max(0, endTs - startTs) : 0;
  return {
    sessionId,
    cwd,
    project: project || '',
    startTs,
    endTs,
    durationMs,
    tokens: { ...tokens },
    cost: estimateCost(tokens, p),
  };
}

function emptyStats() {
  return { sessions: [], totals: { count: 0, durationMs: 0, tokens: 0, cost: 0 } };
}

function loadStats(dir = SIGNAL_DIR) {
  try {
    return JSON.parse(fs.readFileSync(path.join(dir, 'stats.json'), 'utf8'));
  } catch {
    return emptyStats();
  }
}

function recordSession(rec, dir = SIGNAL_DIR) {
  const data = loadStats(dir);
  data.sessions.push(rec);
  data.totals.count += 1;
  data.totals.durationMs += rec.durationMs || 0;
  data.totals.tokens += rec.tokens.total || 0;
  data.totals.cost += rec.cost || 0;
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'stats.json'), JSON.stringify(data, null, 2));
  return data;
}

// 按 (cwd, startTs) 更新或新增一条会话记录，并据此重算累计，避免重复计数/翻倍。
// 用于每轮 Stop 也落盘：中途即可看到累计。
function upsertSession(rec, dir = SIGNAL_DIR) {
  const data = loadStats(dir);
  const i = data.sessions.findIndex((s) => s.cwd === rec.cwd && s.startTs === rec.startTs);
  if (i >= 0) data.sessions[i] = rec;
  else data.sessions.push(rec);
  const totals = data.sessions.reduce(
    (t, s) => ({
      count: t.count + 1,
      durationMs: t.durationMs + (s.durationMs || 0),
      tokens: t.tokens + (s.tokens.total || 0),
      cost: t.cost + (s.cost || 0),
    }),
    { count: 0, durationMs: 0, tokens: 0, cost: 0 }
  );
  data.totals = totals;
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'stats.json'), JSON.stringify(data, null, 2));
  return data;
}

module.exports = {
  DEFAULT_PRICES,
  cwdToSlug,
  findTranscript,
  sumUsage,
  estimateCost,
  loadPrices,
  loadStats,
  recordSession,
  upsertSession,
  buildRecord,
  emptyStats,
};
