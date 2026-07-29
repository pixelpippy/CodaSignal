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
