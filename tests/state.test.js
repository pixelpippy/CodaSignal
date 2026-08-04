// tests/state.test.js
const test = require('node:test');
const assert = require('node:assert');
const {
  EVENT_TO_STATE, STATE_LABELS, stateForEvent,
  SessionState, StateManager,
} = require('../src/state.js');

// --- 现有 EVENT_TO_STATE / stateForEvent 回归 ---
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
test('STATE_LABELS covers all states', () => {
  for (const k of ['idle','red','yellow','green']) assert.ok(STATE_LABELS[k]);
});

// --- SessionState 单会话回归（原 AppState 行为） ---
test('SessionState: SessionStart->idle, PreToolUse->yellow, Stop->green', () => {
  const s = new SessionState('s1');
  s.applyEvent('SessionStart', { cwd: 'D:/x/Y', session_id: 's1' });
  assert.equal(s.state, 'idle');
  assert.equal(s.cwd, 'D:/x/Y');
  assert.ok(typeof s.startTs === 'number');
  s.applyEvent('PreToolUse');
  assert.equal(s.state, 'yellow');
  s.applyEvent('Stop');
  assert.equal(s.state, 'green');
  assert.ok(typeof s.endTs === 'number');
});
test('SessionState: Stop while idle does not flash green', () => {
  const s = new SessionState('s1');
  s.applyEvent('Stop');            // 会话开始前的占位 Stop
  assert.equal(s.state, 'idle');
  s.applyEvent('SessionStart', { cwd: 'D:/x/Y' });
  assert.equal(s.state, 'idle');
  s.applyEvent('PreToolUse');
  assert.equal(s.state, 'yellow');
});
test('SessionState: Stop turns green from yellow or red', () => {
  const a = new SessionState('a'); a.applyEvent('PreToolUse'); a.applyEvent('Stop');
  assert.equal(a.state, 'green');
  const b = new SessionState('b'); b.applyEvent('permission_prompt'); b.applyEvent('Stop');
  assert.equal(b.state, 'green');
});
test('SessionState: phase thinking vs executing for yellow label', () => {
  const s = new SessionState('s');
  s.applyEvent('UserPromptSubmit');
  assert.equal(s.state, 'yellow'); assert.equal(s.phase, 'thinking');
  assert.equal(s.snapshot().label, '思考中');
  s.applyEvent('PreToolUse');
  assert.equal(s.phase, 'executing');
  assert.equal(s.snapshot().label, '执行中');
  s.applyEvent('Stop');
  assert.equal(s.state, 'green'); assert.equal(s.phase, null);
});

// --- StateManager 聚合 + 最紧急 ---
test('StateManager: aggregate red-first across sessions', () => {
  const m = new StateManager();
  m.applyEvent('PreToolUse', { session_id: 'A' });   // A 黄
  m.applyEvent('Stop', { session_id: 'B' });         // B 绿
  assert.equal(m.aggregateState(), 'yellow');
  m.applyEvent('permission_prompt', { session_id: 'C' }); // C 红
  assert.equal(m.aggregateState(), 'red');
});
test('StateManager: green if no red/yellow (有绿即绿)', () => {
  const m = new StateManager();
  m.applyEvent('PreToolUse', { session_id: 'A' });   // A 黄
  m.applyEvent('Stop', { session_id: 'A' });         // A 绿（先工作再结束）
  m.applyEvent('SessionStart', { session_id: 'B' }); // B idle
  assert.equal(m.aggregateState(), 'green');
});
test('StateManager: idle only when no active session', () => {
  const m = new StateManager();
  m.applyEvent('SessionStart', { session_id: 'A' }); // idle
  assert.equal(m.aggregateState(), 'idle');
  m.applyEvent('SessionEnd', { session_id: 'A' });   // A 结束
  assert.equal(m.aggregateState(), 'idle');
  assert.equal(m.activeSessions().length, 0);
});
test('StateManager: mostUrgent prefers red then recent', () => {
  const m = new StateManager();
  m.applyEvent('PreToolUse', { session_id: 'A' });
  m.applyEvent('Stop', { session_id: 'B' });
  assert.equal(m.mostUrgent().sessionId, 'A');        // 黄 > 绿
  m.applyEvent('permission_prompt', { session_id: 'C' });
  assert.equal(m.mostUrgent().sessionId, 'C');        // 红最紧急
});
test('StateManager: snapshot returns aggregate + most urgent project', () => {
  const m = new StateManager();
  m.applyEvent('SessionStart', { session_id: 'A', cwd: 'D:/work/ProjX' });
  m.applyEvent('UserPromptSubmit', { session_id: 'A' }); // 黄(思考中)
  const snap = m.snapshot();
  assert.equal(snap.state, 'yellow');
  assert.equal(snap.label, '思考中');
  assert.equal(snap.project, 'ProjX');
  assert.equal(snap.count, 1);
  assert.ok(Array.isArray(snap.sessions));
});
test('StateManager: missing session_id falls back to cwd/default key', () => {
  const m = new StateManager();
  m.applyEvent('PreToolUse', { cwd: 'D:/work/ProjY' });
  assert.equal(m.activeSessions().length, 1);
  assert.equal(m.aggregateState(), 'yellow');
});
test('StateManager: event without session_id/cwd attaches to latest active session', () => {
  const m = new StateManager();
  m.applyEvent('SessionStart', { session_id: 'A', cwd: 'D:/work/ProjZ' });
  m.applyEvent('PreToolUse', {});   // 无 session_id / cwd —— 不应新建幽灵会话
  m.applyEvent('Stop', {});         // 同上，必须落到 A 上
  assert.equal(m.activeSessions().length, 1);
  const a = m.getSession('A');
  assert.ok(a);
  assert.equal(a.state, 'green');   // A 走完 yellow -> green
  assert.equal(m.aggregateState(), 'green');
});
test('StateManager: getSession retrieves session by sid', () => {
  const m = new StateManager();
  const sid = m.applyEvent('SessionStart', { session_id: 'A', cwd: 'D:/work/ProjX' });
  assert.equal(sid, 'A');
  const s = m.getSession('A');
  assert.ok(s);
  assert.equal(s.sessionId, 'A');
  assert.equal(s.cwd, 'D:/work/ProjX');
  assert.equal(m.getSession('nope'), undefined);
});
