// tests/state.test.js
const test = require('node:test');
const assert = require('node:assert');
const { EVENT_TO_STATE, STATE_LABELS, stateForEvent, AppState } = require('../src/state.js');

test('stateForEvent maps known events', () => {
  assert.equal(stateForEvent('permission_prompt'), 'red');
  assert.equal(stateForEvent('PreToolUse'), 'yellow');
  assert.equal(stateForEvent('PostToolUse'), 'yellow');
  assert.equal(stateForEvent('Stop'), 'green');
  assert.equal(stateForEvent('SessionStart'), 'idle');
  assert.equal(stateForEvent('SessionEnd'), 'idle');
});

test('stateForEvent returns null for unknown', () => {
  assert.equal(stateForEvent('Nope'), null);
});

test('AppState.applyEvent updates state and timestamps', () => {
  const s = new AppState();
  s.applyEvent('SessionStart', { cwd: 'D:/x/Y', sessionId: 'abc' });
  assert.equal(s.state, 'idle');
  assert.equal(s.cwd, 'D:/x/Y');
  assert.ok(typeof s.startTs === 'number');
  s.applyEvent('PreToolUse');
  assert.equal(s.state, 'yellow');
  s.applyEvent('Stop');
  assert.equal(s.state, 'green');
  assert.ok(typeof s.endTs === 'number');
});

test('STATE_LABELS covers all states', () => {
  for (const k of ['idle','red','yellow','green']) assert.ok(STATE_LABELS[k]);
});

test('Stop while idle does not flash green (session-start placeholder Stop)', () => {
  const s = new AppState();
  // 守护进程在 SessionStart 之前先发一个 Stop；空闲时收到应被忽略
  s.applyEvent('Stop');
  assert.equal(s.state, 'idle');
  s.applyEvent('SessionStart', { cwd: 'D:/x/Y' });
  assert.equal(s.state, 'idle');
  s.applyEvent('PreToolUse');
  assert.equal(s.state, 'yellow');
});

test('Stop while working turns green (real turn end)', () => {
  const s = new AppState();
  s.applyEvent('PreToolUse');
  s.applyEvent('Stop');
  assert.equal(s.state, 'green');
});

test('Stop while awaiting approval turns green', () => {
  const s = new AppState();
  s.applyEvent('permission_prompt');
  s.applyEvent('Stop');
  assert.equal(s.state, 'green');
});
