# 多 Agent 并发 + 优先级灯逻辑 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让 CodaSignal 按 `session_id` 区分并发的 CodeBuddy / Claude Code / Codex 会话，并把灯色按「红优先 → 无红则黄 → 无红无黄则绿(idle 不降级) → 全无活跃会话则空闲」聚合；统计面板列出所有活跃会话明细 + 汇总；点击灯聚焦最紧急会话。

**Architecture:** `src/state.js` 拆为 `SessionState`（单会话，复用现有单会话规则，含 `phase` 思考中/执行中）与 `StateManager`（持有 `Map<sessionId, SessionState>`，按 `PRIORITY` 取最严重态做聚合，并提供 `mostUrgent()`）。`main.js` 改用 `StateManager`：`snapshot()` 返回聚合态 + 最紧急项目名/会话数；`get-stats` 返回所有活跃会话数组；按 sid 逐会话落盘；点击聚焦 `mostUrgent().cwd`。渲染层 `renderer.js` 已兼容 snapshot 结构（无需改），`stats.js` 改为渲染会话列表，`hover.js` 显示最紧急会话。

**Tech Stack:** Electron (CommonJS, 无打包/转译)、Node 内置 `node:test` 测试器、Git Bash + `curl` 模拟 hook 事件验证。

## Global Constraints

- 仅支持 Windows（PowerShell 聚焦、无边框窗口 DWM 处理）—— 不改平台范围。
- 应用代码为纯 CommonJS（`require`/`module.exports`），无打包/转译步骤，`src/**` 与 `renderer/**` 直接被 Electron 加载。
- 事件名沿用现有 `EVENT_TO_STATE`；接收端工具无关（`data.event || data.hook_event_name` 已在 `src/server.js`）。
- 端口 `CODASIGNAL_PORT` 默认 `18765`（来自 `src/config.js`），单实例单端口不变。
- 灯色聚合优先级（用户确认）：红 > 黄 > 绿 > 空闲；idle 不把灯降级（有绿即绿）。
- 测试用 `node --test tests/<file>`（不要用 `npm test`，`tests/focus.test.js` 已知过时会使整体报失败）。
- 保留 `[DBG]` 调试日志风格，验证修复后再清理；提交前用 `git status` 确认改动面。

---

### Task 1: src/state.js — SessionState + StateManager + 测试（TDD）

**Files:**
- Modify: `src/state.js`
- Modify (全量重写): `tests/state.test.js`

**Interfaces:**
- Consumes: 现有 `EVENT_TO_STATE`、`STATE_LABELS`、`stateForEvent`、`projectNameFromCwd`（保留导出）。
- Produces:
  - `class SessionState`：构造 `new SessionState(sessionId)`；方法 `applyEvent(event, extra)` 与 `snapshot()`（同原 `AppState` 单会话行为）。
  - `class StateManager`：`new StateManager()`；`applyEvent(event, data) -> sid`；`getSession(sid) -> SessionState|undefined`；`activeSessions() -> SessionState[]`（排除 `ended`）；`aggregateState() -> 'red'|'yellow'|'green'|'idle'`；`mostUrgent() -> SessionState|null`（红>黄>最近 `lastUpdate`）；`snapshot() -> { state, label, count, project, cwd, sessions }`。
  - 导出新增 `SessionState`、`StateManager`；保留 `EVENT_TO_STATE`、`STATE_LABELS`、`stateForEvent`、`projectNameFromCwd`。
  - `PRIORITY = { red:3, yellow:2, green:1, idle:0 }`（模块内常量）。

- [ ] **Step 1: 全量重写 `tests/state.test.js`（先写失败测试）**

```js
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
  m.applyEvent('Stop', { session_id: 'A' });         // A 绿
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
```

- [ ] **Step 2: 运行测试确认失败**

Run: `node --test tests/state.test.js`
Expected: FAIL（报错 `SessionState is not defined` / `StateManager is not defined`，因为 `src/state.js` 尚未导出它们）。

- [ ] **Step 3: 实现 `src/state.js`（在原 `AppState` 基础上改造）**

把原 `AppState` 重命名为 `SessionState`，新增 `StateManager` 与 `PRIORITY`，更新 `module.exports`：

```js
// src/state.js （关键片段，整体替换原文件内容）
const EVENT_TO_STATE = {
  permission_prompt: 'red',
  UserPromptSubmit: 'yellow',
  PreToolUse: 'yellow',
  PostToolUse: 'yellow',
  Stop: 'green',
  SessionStart: 'idle',
  SessionEnd: 'idle',
};
const STATE_LABELS = {
  idle: '空闲', red: '等待审批', yellow: '思考中', green: '已完成',
};
function stateForEvent(event) {
  return Object.prototype.hasOwnProperty.call(EVENT_TO_STATE, event) ? EVENT_TO_STATE[event] : null;
}
function projectNameFromCwd(cwd) {
  const parts = String(cwd).replace(/[\\/]+$/, '').split(/[\\/]/);
  return parts[parts.length - 1] || '';
}

const PRIORITY = { red: 3, yellow: 2, green: 1, idle: 0 };

class SessionState {
  constructor(sessionId) {
    this.sessionId = sessionId;
    this.state = 'idle';
    this.phase = null;
    this.cwd = undefined;
    this.transcriptPath = undefined;
    this.startTs = undefined;
    this.endTs = undefined;
    this.lastUpdate = Date.now();
  }
  applyEvent(event, extra = {}) {
    if (event === 'Stop') {
      if (this.state === 'yellow' || this.state === 'red') {
        this.state = 'green';
        this.phase = null;
      }
    } else {
      const s = stateForEvent(event);
      if (s) {
        this.state = s;
        if (s === 'yellow') {
          this.phase = event === 'UserPromptSubmit' ? 'thinking' : 'executing';
        } else {
          this.phase = null;
        }
      }
    }
    if (event === 'SessionStart') {
      this.startTs = Date.now();
      if (extra.cwd) this.cwd = extra.cwd;
      if (extra.sessionId || extra.session_id) this.sessionId = extra.sessionId || extra.session_id;
      if (extra.transcript_path) this.transcriptPath = extra.transcript_path;
    }
    if (event === 'SessionEnd' || event === 'Stop') {
      this.endTs = Date.now();
    }
    this.lastUpdate = Date.now();
    return this;
  }
  snapshot() {
    const label = this.state === 'yellow' && this.phase === 'executing'
      ? '执行中'
      : (STATE_LABELS[this.state] || this.state);
    return {
      state: this.state,
      label,
      cwd: this.cwd,
      project: this.cwd ? projectNameFromCwd(this.cwd) : '',
      startTs: this.startTs,
      endTs: this.endTs,
    };
  }
}

class StateManager {
  constructor() {
    this.sessions = new Map(); // sessionId -> SessionState
  }
  _sid(data = {}) {
    return data.session_id || data.sessionId || (data.cwd ? 'cwd:' + data.cwd : 'default');
  }
  getSession(sid) { return this.sessions.get(sid); }
  activeSessions() {
    return Array.from(this.sessions.values()).filter((s) => s.state !== 'ended');
  }
  applyEvent(event, data = {}) {
    const sid = this._sid(data);
    let s = this.sessions.get(sid);
    if (!s) { s = new SessionState(sid); this.sessions.set(sid, s); }
    if (event === 'SessionEnd') {
      s.state = 'ended';
      s.endTs = Date.now();
      s.lastUpdate = Date.now();
      return sid;
    }
    s.applyEvent(event, data);
    return sid;
  }
  aggregateState() {
    let best = 'idle';
    for (const s of this.activeSessions()) {
      if (PRIORITY[s.state] > PRIORITY[best]) best = s.state;
    }
    return best;
  }
  mostUrgent() {
    const list = this.activeSessions();
    if (!list.length) return null;
    list.sort((a, b) => {
      const pa = PRIORITY[a.state], pb = PRIORITY[b.state];
      if (pb !== pa) return pb - pa;
      return (b.lastUpdate || 0) - (a.lastUpdate || 0);
    });
    return list[0];
  }
  snapshot() {
    const agg = this.aggregateState();
    const urgent = this.mostUrgent();
    const label = agg === 'yellow'
      ? (urgent && urgent.phase === 'executing' ? '执行中' : '思考中')
      : (STATE_LABELS[agg] || agg);
    return {
      state: agg,
      label,
      count: this.activeSessions().length,
      project: urgent ? urgent.snapshot().project : '',
      cwd: urgent ? urgent.cwd : undefined,
      sessions: this.activeSessions().map((s) => s.snapshot()),
    };
  }
}

module.exports = {
  EVENT_TO_STATE, STATE_LABELS, stateForEvent, projectNameFromCwd,
  SessionState, StateManager, PRIORITY,
};
```

- [ ] **Step 4: 运行测试确认通过**

Run: `node --test tests/state.test.js`
Expected: 全部 PASS（16 个 test）。

- [ ] **Step 5: 提交**

```bash
git add src/state.js tests/state.test.js
git commit -m "feat(state): 按 session_id 区分会话并聚合灯色(红>黄>绿>空闲)"
```

---

### Task 2: main.js — 接入 StateManager、多会话统计、聚焦最紧急

**Files:**
- Modify: `main.js`

**Interfaces:**
- Consumes: `StateManager`（来自 `src/state.js`）、`sumUsage`/`findTranscript`/`estimateCost`/`loadPrices`/`loadStats`/`upsertSession`/`buildRecord`（来自 `src/stats.js`）、`focusTerminal`（来自 `src/focus.js`）、`startServer`（来自 `src/server.js`）、`defaultPort`（来自 `src/config.js`）。
- Produces: `get-stats` 返回 `{ current: SessionStat[], totals, sessions, prices }`，其中 `current` 为**活跃会话数组**（按优先级降序，最紧急在前）；`state-update` 推送 `StateManager.snapshot()`；`focus-terminal` 聚焦 `mostUrgent().cwd`。

- [ ] **Step 1: 替换顶部 import 与实例**

`src/state.js` 的引入改为 `StateManager`，并把 `new AppState()` 换成 `new StateManager()`：

```js
const { StateManager, projectNameFromCwd } = require('./src/state.js');
// ...（其余 require 不变）
const appState = new StateManager();
```

- [ ] **Step 2: 改写 `sendState` 使用聚合 snapshot**

```js
function sendState() {
  const snap = appState.snapshot();
  if (lightWin) lightWin.webContents.send('state-update', snap);
  if (tray) tray.setImage(makeIcon(snap.state));
}
```

- [ ] **Step 3: 用 `computeSessionTokens` / `currentDurationMs` 替换原单会话版**

```js
function computeSessionTokens(session) {
  if (session.transcriptPath && fs.existsSync(session.transcriptPath)) {
    return sumUsage(session.transcriptPath);
  }
  if (!session.cwd) return null;
  const tp = findTranscript(session.cwd);
  if (!tp) return null;
  return sumUsage(tp);
}
function currentDurationMs(session) {
  if (!session.startTs) return 0;
  const end = session.endTs || Date.now();
  return Math.max(0, end - session.startTs);
}
```

- [ ] **Step 4: 改写 `get-stats` handler 返回活跃会话数组（按优先级降序）**

```js
ipcMain.handle('get-stats', () => {
  const prices = loadPrices();
  const stored = loadStats();
  const ORDER = { red: 3, yellow: 2, green: 1, idle: 0 };
  const current = appState.activeSessions()
    .map((s) => {
      const tokens = computeSessionTokens(s)
        || { input: 0, output: 0, cacheCreation: 0, cacheRead: 0, total: 0 };
      return {
        sessionId: s.sessionId,
        project: s.cwd ? projectNameFromCwd(s.cwd) : '',
        cwd: s.cwd,
        state: s.state,
        tokens,
        cost: estimateCost(tokens, prices),
        startTs: s.startTs,
        endTs: s.endTs,
        durationMs: currentDurationMs(s),
      };
    })
    .sort((a, b) => (ORDER[b.state] || 0) - (ORDER[a.state] || 0));
  return { current, totals: stored.totals, sessions: stored.sessions, prices };
});
```

- [ ] **Step 5: 改写 server 回调——按 sid 落盘 + 发送聚合状态**

```js
const server = await startServer(defaultPort(), (event, data) => {
  const sid = appState.applyEvent(event, data || {});
  if (event === 'Stop' || event === 'SessionEnd') {
    const s = appState.getSession(sid);
    if (s && s.startTs) {
      const prices = loadPrices();
      const tk = computeSessionTokens(s)
        || { input: 0, output: 0, cacheCreation: 0, cacheRead: 0, total: 0 };
      upsertSession(buildRecord({
        sessionId: s.sessionId,
        cwd: s.cwd,
        project: s.cwd ? projectNameFromCwd(s.cwd) : '',
        startTs: s.startTs, endTs: s.endTs, tokens: tk,
      }, prices));
    }
  }
  sendState();
});
```

- [ ] **Step 6: 改写 `focus-terminal` 聚焦最紧急会话**

```js
ipcMain.on('focus-terminal', () => {
  const u = appState.mostUrgent();
  focusTerminal(u && u.cwd);
});
```

- [ ] **Step 7: 运行 `node -e` 语法校验 + 启动验证无导入错误**

```bash
node -e "require('./main.js')" 2>&1 | head -5 || true
```
Expected: 因 Electron 主进程需 GUI，可能报 `app is not defined` 类错误属正常；重点确认**没有** `Cannot find module` / `StateManager is not defined` 等引用错误。随后用 Task 6 的手动验证确认运行期行为。

- [ ] **Step 8: 提交**

```bash
git add main.js
git commit -m "feat(main): 接入 StateManager，多会话统计/落盘/聚焦最紧急"
```

---

### Task 3: renderer — 统计面板列出所有活跃会话 + 汇总

**Files:**
- Modify: `renderer/stats.js`
- Modify (可选，仅文案): `renderer/stats.html`（将「本次会话」标题改为「活跃会话」）

**Interfaces:**
- Consumes: `window.api.getStats()` 现在返回 `{ current: SessionStat[], totals, sessions, prices }`（`current` 为数组，已按优先级降序）。
- Produces: 在 `#current .body` 渲染每会话一段；`#totals .body` 与 `#history .body` 维持原逻辑。

- [ ] **Step 1: 重写 `renderer/stats.js` 渲染数组**

```js
// renderer/stats.js
function fmtMs(ms) {
  if (!ms) return '0s';
  const s = Math.round(ms / 1000);
  const m = Math.floor(s / 60);
  return m > 0 ? `${m}m${s % 60}s` : `${s}s`;
}
function fmtTokens(n) { return (n || 0).toLocaleString(); }

async function refresh() {
  const data = await window.api.getStats();
  const list = data.current || [];
  document.querySelector('#current .body').textContent = list.length
    ? list.map((c) => `项目: ${c.project} [${c.state}]\n时长: ${fmtMs(c.durationMs)}\ninput: ${fmtTokens(c.tokens.input)}\noutput: ${fmtTokens(c.tokens.output)}\ncache_read: ${fmtTokens(c.tokens.cacheRead)}\ncache_creation: ${fmtTokens(c.tokens.cacheCreation)}\n合计: ${fmtTokens(c.tokens.total)}\n费用(${data.prices.currency}): ${c.cost.toFixed(4)}`).join('\n\n')
    : '（暂无活跃会话 token 数据）';

  const t = data.totals || {};
  document.querySelector('#totals .body').textContent =
    `会话数: ${t.count || 0}\n总时长: ${fmtMs(t.durationMs)}\n总 token: ${fmtTokens(t.tokens)}\n总费用: ${(t.cost || 0).toFixed(4)} ${data.prices.currency}`;

  const hist = (data.sessions || []).slice(-20).reverse()
    .map((s) => `• ${s.project} | ${fmtMs(s.durationMs)} | ${fmtTokens((s.tokens && s.tokens.total) || 0)} tok | ${(s.cost || 0).toFixed(4)}`)
    .join('\n') || '（暂无历史）';
  document.querySelector('#history .body').textContent = hist;
}

refresh();
setInterval(refresh, 3000);
```

- [ ] **Step 2: （可选）更新 `renderer/stats.html` 标题**

将 `<section id="current"><h2>本次会话</h2>` 改为 `<section id="current"><h2>活跃会话</h2>`。

- [ ] **Step 3: 提交**

```bash
git add renderer/stats.js renderer/stats.html
git commit -m "feat(renderer): 统计面板列出所有活跃会话明细+汇总"
```

---

### Task 4: hover 速览显示最紧急会话 + 确认灯面文字兼容

**Files:**
- Modify: `renderer/hover.js`
- Verify (无需改): `renderer/renderer.js`（已读取 `s.state`/`s.label`/`s.project`，与 `StateManager.snapshot()` 结构兼容）

**Interfaces:**
- Consumes: `window.api.getStats()` 的 `current[0]`（已按优先级降序，即最紧急会话）。
- Produces: hover 弹窗显示最紧急会话 token/时长。

- [ ] **Step 1: 改写 `renderer/hover.js` 取 `current[0]`**

```js
// renderer/hover.js
function fmtMoney(n) {
  if (n == null) return '—';
  return '$' + (Math.round(n * 1000) / 1000).toFixed(3);
}
function fmtTokens(t) {
  if (!t) return '—';
  const total = t.total || (t.input + t.output) || 0;
  return total.toLocaleString('en-US');
}
function fmtDur(ms) {
  if (!ms) return '—';
  const s = Math.round(ms / 1000);
  const m = Math.floor(s / 60);
  return m > 0 ? `${m}m ${s % 60}s` : `${s}s`;
}
function render(data) {
  if (!data) return;
  const cur = (data.current && data.current[0]) || null; // 最紧急会话
  document.getElementById('cur').textContent = cur ? `${fmtTokens(cur.tokens)} · ${fmtDur(cur.durationMs)}` : '无';
  document.getElementById('cost').textContent = fmtMoney(data.totals && data.totals.cost);
  document.getElementById('sessions').textContent = (data.current ? data.current.length : 0).toString();
  const t = data.totals && data.totals.tokens;
  document.getElementById('tokens').textContent = fmtTokens(t);
}
window.api.onHoverStats(render);
document.body.addEventListener('mouseenter', () => window.api.hoverEnter());
document.body.addEventListener('mouseleave', () => window.api.hoverLeave());
```

- [ ] **Step 2: 确认 `renderer/renderer.js` 兼容**

检查 `renderer/renderer.js` 的 `onState` 回调仅用 `s.state`/`s.label`/`s.project`——`StateManager.snapshot()` 均提供，无需改动。在 PR 描述中记录「灯面文字沿用最紧急项目名，符合用户选择」。

- [ ] **Step 3: 提交**

```bash
git add renderer/hover.js
git commit -m "feat(renderer): hover 速览显示最紧急会话"
```

---

### Task 5: hooks/setup-hooks.md — 新增 Claude Code / Codex 章节

**Files:**
- Modify: `hooks/setup-hooks.md`

**Interfaces:**
- Consumes: 通用 hook 模板（转发 stdin + 补 `cwd` + `|| true`）；关键提醒**原样转发 `session_id`**。
- Produces: 文档列出三工具配置位置与事件清单。

- [ ] **Step 1: 在 `hooks/setup-hooks.md` 现有 CodeBuddy 章节之后追加**

```markdown
## Claude Code

配置文件：`~/.claude/settings.json`（结构同 CodeBuddy 的 `hooks` 块）。对以下事件各加一个 command hook，命令均用上方「通用模板」：

- `SessionStart`、`UserPromptSubmit`、`PreToolUse`、`PostToolUse`、`Stop`、`SessionEnd`

注意：Claude Code 会在 stdin 的 JSON 中给出 `session_id` / `transcript_path` / `cwd` / `hook_event_name`，**务必原样转发**（模板已处理），CodaSignal 靠 `session_id` 区分并发会话。合并时保留文件已有其它配置项，勿整体覆盖。JSON 内双引号需转义为 `\"`。

## OpenAI Codex

Codex CLI 的 hook 配置通常为 `hooks.json`，预期位置 `~/.codex/hooks.json`（以 `codex` 文档为准；事件名与上面一致）。命令同样用「通用模板」。**若 Codex 不发出 `UserPromptSubmit`，灯会在 `PreToolUse` 才变黄**，属已知可接受差异。
```

- [ ] **Step 2: 提交**

```bash
git add hooks/setup-hooks.md
git commit -m "docs(hooks): 新增 Claude Code / Codex 配置章节(强调 session_id 转发)"
```

---

### Task 6: 手动验证 — 多 agent 并发聚合

**Files:** 无代码改动；使用 Git Bash + `curl` 向 `127.0.0.1:18765/event` 发事件。

**Interfaces:**
- Consumes: 已构建/运行的 CodaSignal（`npm start` 或 `npm run dist` 产物）；本地服务监听 `POST /event`。
- Produces: 肉眼/日志确认灯色按优先级聚合。

- [ ] **Step 1: 启动应用（如未运行）**

```bash
npm start
```
确认托盘出现、悬浮灯可见。

- [ ] **Step 2: 模拟「A 黄 + B 绿」→ 灯应黄**

```bash
curl -s -X POST http://127.0.0.1:18765/event -d '{"hook_event_name":"PreToolUse","session_id":"A","cwd":"/d/agent-workspace/codebuddy/CodaSignal","transcript_path":"C:/x/a.jsonl"}'
curl -s -X POST http://127.0.0.1:18765/event -d '{"hook_event_name":"Stop","session_id":"B","cwd":"/d/agent-workspace/codebuddy/CodaSignal","transcript_path":"C:/x/b.jsonl"}'
```
Expected: 灯黄（黄 > 绿）。

- [ ] **Step 3: 模拟「A 黄 + B 绿 + C 红」→ 灯应红**

```bash
curl -s -X POST http://127.0.0.1:18765/event -d '{"hook_event_name":"permission_prompt","session_id":"C","cwd":"/d/agent-workspace/codebuddy/CodaSignal"}'
```
Expected: 灯红（红优先）。

- [ ] **Step 4: 模拟「C 结束」→ 回到黄**

```bash
curl -s -X POST http://127.0.0.1:18765/event -d '{"hook_event_name":"SessionEnd","session_id":"C","cwd":"/d/agent-workspace/codebuddy/CodaSignal"}'
```
Expected: 灯黄（C 移除后剩 A 黄 + B 绿）。

- [ ] **Step 5: 模拟「A、B 都结束」→ 空闲**

```bash
curl -s -X POST http://127.0.0.1:18765/event -d '{"hook_event_name":"SessionEnd","session_id":"A","cwd":"/d/agent-workspace/codebuddy/CodaSignal"}'
curl -s -X POST http://127.0.0.1:18765/event -d '{"hook_event_name":"SessionEnd","session_id":"B","cwd":"/d/agent-workspace/codebuddy/CodaSignal"}'
```
Expected: 灯空闲。

- [ ] **Step 6: 验证统计面板与点击聚焦**

打开统计面板（`get-stats` 应返回 `current` 数组，多会话时多行）；点击灯应聚焦 `mostUrgent().cwd` 指向的终端。可按需加临时 `[DBG]` 日志确认 `snapshot()` 与 `mostUrgent()` 取值。

- [ ] **Step 7: 提交（如有调试日志清理/微调）**

```bash
git add -A
git commit -m "chore: 多 agent 并发验证微调" || echo "no changes"
```

---

## 自审（Self-Review）

**1. Spec 覆盖：** §1 目标（并发/优先级/统计列表/聚焦最紧急/灯面最紧急项目名）→ Task 1(聚合)+Task2(统计/聚焦)+Task3(列表)+Task4(hover)+renderer 兼容(灯面最紧急项目名)。§3 事件映射 → 复用 `EVENT_TO_STATE`，Task1 回归测试覆盖。§4 hook 配置 → Task5。§5 核心设计(SessionState/StateManager/聚合/mostUrgent/snapshot) → Task1 实现 + 测试。§5.2 main.js 改造 → Task2。§5.3 renderer → Task3/Task4。§6 测试 → Task1。§8 验证 → Task6。全覆盖。

**2. 占位符扫描：** 无 TBD/TODO；每个代码步骤均含实际可粘贴代码；无「类似 Task N」引用（各 Task 自带代码）。

**3. 类型一致性：** `StateManager.snapshot()` 返回 `{state,label,count,project,cwd,sessions}`，`renderer.js` 用 `state/label/project` 一致；`get-stats` 返回 `{current:[]}` 与 `stats.js`(current 数组)、`hover.js`(current[0]) 一致；`mostUrgent()` 返回 `SessionState`（有 `cwd`/`sessionId`），`main.js` 聚焦用 `u.cwd` 一致；`applyEvent(event,data)` 返回 `sid`，`main.js` 落盘用 `getSession(sid)` 一致。命名统一，无偏差。
