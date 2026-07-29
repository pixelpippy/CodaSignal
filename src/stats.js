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
  const dir = path.join(projectsDir, cwdToSlug(cwd));
  if (!fs.existsSync(dir)) return null;
  const files = fs.readdirSync(dir)
    .filter((f) => f.endsWith('.jsonl'))
    .map((f) => ({ f, m: fs.statSync(path.join(dir, f)).mtimeMs }))
    .sort((a, b) => b.m - a.m);
  return files.length ? path.join(dir, files[0].f) : null;
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

module.exports = {
  DEFAULT_PRICES,
  cwdToSlug,
  findTranscript,
  sumUsage,
  estimateCost,
  loadPrices,
};
