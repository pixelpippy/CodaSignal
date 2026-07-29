// tests/stats.test.js
const test = require('node:test');
const assert = require('node:assert');
const path = require('node:path');
const { cwdToSlug, findTranscript, sumUsage, estimateCost, DEFAULT_PRICES } = require('../src/stats.js');

test('cwdToSlug encodes path like CodeBuddy projects dir', () => {
  assert.equal(cwdToSlug('D:/agent-workspace/codebuddy/CodaSignal'), 'd-agent-workspace-codebuddy-codasignal');
  assert.equal(cwdToSlug('C:\\Users\\me\\proj'), 'c-users-me-proj');
});

test('sumUsage累加 input/output/cache', () => {
  const p = path.join(__dirname, 'fixtures', 'sample.jsonl');
  const r = sumUsage(p);
  assert.equal(r.input, 300);
  assert.equal(r.output, 50);
  assert.equal(r.cacheCreation, 5);
  assert.equal(r.cacheRead, 120);
  assert.equal(r.total, 475);
});

test('estimateCost matches单价公式', () => {
  const tokens = { input: 1_000_000, output: 0, cacheCreation: 0, cacheRead: 0 };
  assert.equal(estimateCost(tokens, DEFAULT_PRICES), 3.0); // input_per_1m=3.0
});

const { loadStats, recordSession, buildRecord } = require('../src/stats.js');
const os = require('node:os');
const fs = require('node:fs');
const crypto = require('node:crypto');

test('recordSession appends and updates totals', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'codasig-'));
  try {
    const tokens = { input: 100, output: 10, cacheCreation: 0, cacheRead: 0, total: 110 };
    const rec = buildRecord({ sessionId: 's1', cwd: 'D:/p', project: 'p', startTs: 0, endTs: 1000, tokens });
    const data = recordSession(rec, dir);
    assert.equal(data.sessions.length, 1);
    assert.equal(data.totals.count, 1);
    assert.equal(data.totals.durationMs, 1000);
    assert.equal(data.totals.tokens, 110);
    assert.ok(data.totals.cost >= 0);
    const reloaded = loadStats(dir);
    assert.equal(reloaded.sessions.length, 1);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
