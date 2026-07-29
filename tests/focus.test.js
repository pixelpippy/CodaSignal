// tests/focus.test.js
const test = require('node:test');
const assert = require('node:assert');
const { parsePanes, findWindowIdForCwd, focusTerminal } = require('../src/focus.js');

const SAMPLE = JSON.stringify([
  { window_id: 'w1', pane_id: 'p1', cwd: 'D:/other' },
  { window_id: 'w2', pane_id: 'p2', cwd: 'D:/agent-workspace/codebuddy/CodaSignal' },
]);

test('parsePanes returns array', () => {
  assert.equal(parsePanes(SAMPLE).length, 2);
});

test('findWindowIdForCwd matches by cwd case-insensitively', () => {
  const panes = parsePanes(SAMPLE);
  assert.equal(findWindowIdForCwd(panes, 'd:/agent-workspace/codebuddy/codasignal'), 'w2');
  assert.equal(findWindowIdForCwd(panes, 'D:/nope'), null);
});

test('focusTerminal returns false when no matching window', () => {
  // 真实环境才会调用 wezterm；这里用不存在的 cwd 验证“找不到即返回 false”的兜底
  assert.equal(focusTerminal('D:/definitely-not-a-real-cwd-xyz'), false);
});
