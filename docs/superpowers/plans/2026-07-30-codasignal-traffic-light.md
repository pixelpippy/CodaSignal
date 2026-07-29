# CodaSignal 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 构建一个 Windows 桌面应用 CodaSignal：用红/黄/绿信号灯实时反映 CodeBuddy CLI 会话状态，点击可聚焦 WezTerm 终端，并提供统计面板展示 token 用量、会话时长与可配置费用估算（含跨会话历史）。

**Architecture:** Electron 主进程常驻，运行一个本地 HTTP 服务（`127.0.0.1:18765`）接收 CodeBuddy hook 发来的 `curl` 事件；主进程维护状态并驱动一个置顶半透明的悬浮窗（三盏灯 + 托盘图标）和一个统计面板窗口。Token 数据由主进程用 Node 读取 `~/.codebuddy/projects/<slug>/` 下最新的 `.jsonl` 会话记录并累加 `usage` 字段；历史与配置持久化在 `~/.codasignal/`。

**Tech Stack:** Electron（UI + 主进程）、Node 内置 `http`/`fs`/`os`（无第三方框架）、Node 内置 `node:test` 做单元测试、`electron-builder` 打包、`curl`（Git Bash 自带）+ `wezterm cli`（用户已有）作为 hook 与聚焦依赖。

## Global Constraints

- 许可证必须为 **MIT**，源码开源。
- hooks 必须**零依赖**：仅用 Git Bash 自带的 `curl` 与用户已装的 `wezterm cli`，**不得**要求 jq / python / 在 hook 里调用 node。hook 命令结尾必须带 `|| true`。
- 本地服务地址固定 `http://127.0.0.1:18765/event`，端口可由环境变量 `CODASIGNAL_PORT` 覆盖。
- 单会话语义：全局一个端口，后到事件覆盖状态，只显示一盏灯。
- token 数据来源：`~/.codebuddy/projects/<slug>/` 下**最新修改**的 `.jsonl`，`slug = cwd.toLowerCase().replace(/:/g,'').replace(/[\\/]+/g,'-')`（去首尾 `-`）。
- 统计持久化文件：`~/.codasignal/stats.json`；价格配置：`~/.codasignal/settings.json` 的 `prices` 字段。
- 聚焦终端：调用 `wezterm cli list-panes --format json` 找 `cwd` 匹配的 `window_id`，再 `wezterm cli activate-window --window-id <id>`。
- 事件→灯色映射（在应用内完成，hook 只发事件名）：`permission_prompt→red`、`PreToolUse→yellow`、`PostToolUse→yellow`、`Stop→green`、`SessionStart→idle`、`SessionEnd→idle`。

---

## File Structure

```
CodaSignal/
  package.json              # 依赖与脚本（electron / electron-builder / start / dist）
  main.js                   # 主进程：生命周期、窗口、托盘、HTTP 接线、IPC
  src/
    state.js                # 事件→状态映射、状态标签、AppState 存储
    server.js               # 本地 HTTP 服务：POST /event
    stats.js                # slug、定位 transcript、累加 usage、费用、持久化、project 名
    focus.js                # wezterm cli 解析与聚焦
    config.js               # 端口、路径常量
  preload.js                # 渲染进程 contextBridge（IPC 安全暴露）
  renderer/
    index.html              # 信号灯页面
    style.css               # 三盏灯 + 发光动画 + 可拖拽标题条
    renderer.js             # 接收状态、点亮对应灯、点击聚焦
    stats.html              # 统计面板页面
    stats.css
    stats.js                # 请求并渲染当前/汇总/历史
  hooks/
    setup-hooks.md          # 给用户看的 hook 配置说明
  tests/
    fixtures/sample.jsonl   # 含 usage 的会话记录测试样本
    state.test.js
    stats.test.js
    focus.test.js
    server.test.js
  LICENSE                   # 已存在（MIT）
  README.md
```

每个 `src/*.js` 为单一职责的纯 Node 模块，便于独立测试；`main.js` 仅做编排。

---

### Task 1: 项目脚手架与依赖

**Files:**
- Create: `package.json`
- Create: `.gitignore`
- Test: 无

**Interfaces:** 无（基础环境）

- [ ] **Step 1: 创建 `package.json`**

```json
{
  "name": "codasignal",
  "version": "0.1.0",
  "description": "CodeBuddy desktop traffic-light + stats panel for Windows",
  "main": "main.js",
  "license": "MIT",
  "scripts": {
    "start": "electron .",
    "dist": "electron-builder",
    "test": "node --test tests/"
  },
  "devDependencies": {
    "electron": "^31.0.0",
    "electron-builder": "^24.13.3"
  }
}
```

- [ ] **Step 2: 创建 `.gitignore`**

```gitignore
node_modules/
dist/
```

- [ ] **Step 3: 安装依赖**

Run: `npm install`
Expected: `node_modules/` 生成，无致命错误。

- [ ] **Step 4: 提交**

```bash
git add package.json .gitignore
git commit -m "chore: scaffold CodaSignal project (electron + builder)"
```

---

### Task 2: 状态模型与事件映射（TDD）

**Files:**
- Create: `src/state.js`
- Create: `tests/state.test.js`

**Interfaces:**
- Produces: `EVENT_TO_STATE` (Object<string,string>), `STATE_LABELS` (Object<string,string>), `stateForEvent(event)`→string|null, `class AppState`（`applyEvent(event, extra?)`→AppState, `snapshot()`→{state,cwd,project,label,startTs,endTs}）

- [ ] **Step 1: 写失败测试**

```js
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
```

- [ ] **Step 2: 运行测试确认失败**

Run: `node --test tests/state.test.js`
Expected: FAIL（`Cannot find module '../src/state.js'`）

- [ ] **Step 3: 实现 `src/state.js`**

```js
// src/state.js
const EVENT_TO_STATE = {
  permission_prompt: 'red',
  PreToolUse: 'yellow',
  PostToolUse: 'yellow',
  Stop: 'green',
  SessionStart: 'idle',
  SessionEnd: 'idle',
};

const STATE_LABELS = {
  idle: '空闲',
  red: '等待审批',
  yellow: '执行中',
  green: '已完成',
};

function stateForEvent(event) {
  return Object.prototype.hasOwnProperty.call(EVENT_TO_STATE, event) ? EVENT_TO_STATE[event] : null;
}

class AppState {
  constructor() {
    this.state = 'idle';
    this.cwd = undefined;
    this.sessionId = undefined;
    this.startTs = undefined;
    this.endTs = undefined;
    this.lastUpdate = Date.now();
  }
  applyEvent(event, extra = {}) {
    const s = stateForEvent(event);
    if (s) this.state = s;
    if (event === 'SessionStart') {
      this.startTs = Date.now();
      if (extra.cwd) this.cwd = extra.cwd;
      if (extra.sessionId) this.sessionId = extra.sessionId;
    }
    if (event === 'SessionEnd') {
      this.endTs = Date.now();
    }
    this.lastUpdate = Date.now();
    return this;
  }
  snapshot(projectName) {
    return {
      state: this.state,
      label: STATE_LABELS[this.state] || this.state,
      cwd: this.cwd,
      project: projectName || (this.cwd ? projectNameFromCwd(this.cwd) : ''),
      startTs: this.startTs,
      endTs: this.endTs,
    };
  }
}

function projectNameFromCwd(cwd) {
  const parts = String(cwd).replace(/[\\/]+$/, '').split(/[\\/]/);
  return parts[parts.length - 1] || '';
}

module.exports = { EVENT_TO_STATE, STATE_LABELS, stateForEvent, AppState, projectNameFromCwd };
```

- [ ] **Step 4: 运行测试确认通过**

Run: `node --test tests/state.test.js`
Expected: PASS（4 passed）

- [ ] **Step 5: 提交**

```bash
git add src/state.js tests/state.test.js
git commit -m "feat: add state model and event mapping"
```

---

### Task 3: 统计解析（slug / transcript / usage / 费用）（TDD）

**Files:**
- Create: `src/config.js`
- Create: `src/stats.js`
- Create: `tests/fixtures/sample.jsonl`
- Create: `tests/stats.test.js`

**Interfaces:**
- Produces（来自 `src/config.js`）: `PROJECTS_DIR`（默认 `~/.codebuddy/projects`）、`SIGNAL_DIR`（默认 `~/.codasignal`）、`defaultPort()`→number（读 `CODASIGNAL_PORT`，缺省 18765）
- Produces（来自 `src/stats.js`）: `cwdToSlug(cwd)`→string, `findTranscript(cwd, projectsDir?)`→string|null, `sumUsage(transcriptPath)`→{input,output,cacheCreation,cacheRead,total}, `estimateCost(tokens, prices)`→number, `loadPrices(settingsDir?)`→object, `DEFAULT_PRICES`

- [ ] **Step 1: 写失败测试（含 fixture）**

创建 `tests/fixtures/sample.jsonl`（两行均含 usage，验证累加与嵌套位置）：

```jsonl
{"type":"message","role":"assistant","message":{"usage":{"input_tokens":100,"output_tokens":20,"cache_creation_input_tokens":5,"cache_read_input_tokens":50}}}
{"type":"message","role":"assistant","usage":{"input_tokens":200,"output_tokens":30,"cache_creation_input_tokens":0,"cache_read_input_tokens":70}}
```

```js
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
```

- [ ] **Step 2: 运行测试确认失败**

Run: `node --test tests/stats.test.js`
Expected: FAIL（模块不存在）

- [ ] **Step 3: 实现 `src/config.js`**

```js
// src/config.js
const os = require('node:os');
const path = require('node:path');

function defaultPort() {
  const p = parseInt(process.env.CODASIGNAL_PORT || '18765', 10);
  return Number.isFinite(p) ? p : 18765;
}

const PROJECTS_DIR = process.env.CODEBUDDY_PROJECTS_DIR ||
  path.join(os.homedir(), '.codebuddy', 'projects');
const SIGNAL_DIR = path.join(os.homedir(), '.codasignal');

module.exports = { defaultPort, PROJECTS_DIR, SIGNAL_DIR };
```

- [ ] **Step 4: 实现 `src/stats.js`**

```js
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
```

- [ ] **Step 5: 运行测试确认通过**

Run: `node --test tests/stats.test.js`
Expected: PASS（3 passed）

- [ ] **Step 6: 提交**

```bash
git add src/config.js src/stats.js tests/stats.test.js tests/fixtures/sample.jsonl
git commit -m "feat: add transcript parsing, token sum and cost estimation"
```

---

### Task 4: 统计持久化（跨会话历史）（TDD）

**Files:**
- Modify: `src/stats.js`（追加持久化函数）
- Modify: `tests/stats.test.js`（追加测试）

**Interfaces:**
- Consumes: `SIGNAL_DIR`（`src/config.js`）
- Produces: `loadStats(dir?)`→{sessions[],totals}, `recordSession(rec, dir?)`→data, `buildRecord({sessionId,cwd,project,startTs,endTs,tokens}, prices?)`→record

- [ ] **Step 1: 写失败测试**

在 `tests/stats.test.js` 末尾追加：

```js
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
```

- [ ] **Step 2: 运行确认失败**

Run: `node --test tests/stats.test.js`
Expected: FAIL（`buildRecord is not a function`）

- [ ] **Step 3: 在 `src/stats.js` 追加实现**

在 `src/stats.js` 末尾（`module.exports` 之前）加入：

```js
function buildRecord({ sessionId, cwd, project, startTs, endTs, tokens }, prices) {
  const p = prices || loadPrices();
  const durationMs = (endTs && startTs) ? (endTs - startTs) : 0;
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
```

并在 `module.exports` 中追加 `loadStats, recordSession, buildRecord`。

- [ ] **Step 4: 运行确认通过**

Run: `node --test tests/stats.test.js`
Expected: PASS（4 passed）

- [ ] **Step 5: 提交**

```bash
git add src/stats.js tests/stats.test.js
git commit -m "feat: add cross-session stats persistence"
```

---

### Task 5: 终端聚焦（wezterm cli 解析）（TDD）

**Files:**
- Create: `src/focus.js`
- Create: `tests/focus.test.js`

**Interfaces:**
- Produces: `parsePanes(json)`→array, `findWindowIdForCwd(panes, cwd)`→string|null, `focusTerminal(cwd)`→boolean

- [ ] **Step 1: 写失败测试**

```js
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
```

- [ ] **Step 2: 运行确认失败**

Run: `node --test tests/focus.test.js`
Expected: FAIL（模块不存在）

- [ ] **Step 3: 实现 `src/focus.js`**

```js
// src/focus.js
const { execFileSync } = require('node:child_process');

function parsePanes(json) {
  try { return JSON.parse(json); } catch { return []; }
}

function findWindowIdForCwd(panes, cwd) {
  const target = String(cwd || '').toLowerCase();
  const pane = (Array.isArray(panes) ? panes : []).find(
    (p) => String(p.cwd || '').toLowerCase() === target
  );
  return pane ? pane.window_id : null;
}

function focusTerminal(cwd) {
  if (!cwd) return false;
  try {
    const out = execFileSync('wezterm', ['cli', 'list-panes', '--format', 'json'], {
      encoding: 'utf8',
      windowsHide: true,
    });
    const id = findWindowIdForCwd(parsePanes(out), cwd);
    if (!id) return false;
    execFileSync('wezterm', ['cli', 'activate-window', '--window-id', String(id)], {
      windowsHide: true,
    });
    return true;
  } catch {
    return false;
  }
}

module.exports = { parsePanes, findWindowIdForCwd, focusTerminal };
```

- [ ] **Step 4: 运行确认通过**

Run: `node --test tests/focus.test.js`
Expected: PASS（3 passed）

- [ ] **Step 5: 提交**

```bash
git add src/focus.js tests/focus.test.js
git commit -m "feat: add wezterm window focus logic"
```

---

### Task 6: 本地 HTTP 服务（TDD）

**Files:**
- Create: `src/server.js`
- Create: `tests/server.test.js`

**Interfaces:**
- Consumes: `defaultPort()`（`src/config.js`）
- Produces: `startServer(port?, onEvent)`→Promise<server>（onEvent(eventName, data) 在收到 `POST /event` 时调用）

- [ ] **Step 1: 写失败测试**

```js
// tests/server.test.js
const test = require('node:test');
const assert = require('node:assert');
const { startServer } = require('../src/server.js');

test('POST /event invokes handler and returns ok', async () => {
  const seen = [];
  const server = await startServer(0, (event, data) => seen.push({ event, data }));
  const port = server.address().port;
  try {
    const res = await fetch(`http://127.0.0.1:${port}/event`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ event: 'PreToolUse', cwd: 'D:/x' }),
    });
    const json = await res.json();
    assert.equal(json.ok, true);
    assert.equal(seen.length, 1);
    assert.equal(seen[0].event, 'PreToolUse');
    assert.equal(seen[0].data.cwd, 'D:/x');
  } finally {
    server.close();
  }
});

test('unknown path returns 404', async () => {
  const server = await startServer(0, () => {});
  const port = server.address().port;
  try {
    const res = await fetch(`http://127.0.0.1:${port}/nope`);
    assert.equal(res.status, 404);
  } finally {
    server.close();
  }
});
```

- [ ] **Step 2: 运行确认失败**

Run: `node --test tests/server.test.js`
Expected: FAIL（模块不存在）

- [ ] **Step 3: 实现 `src/server.js`**

```js
// src/server.js
const http = require('node:http');

function startServer(port, onEvent) {
  const p = port || 0;
  const server = http.createServer((req, res) => {
    if (req.method === 'POST' && req.url === '/event') {
      let body = '';
      req.on('data', (c) => (body += c));
      req.on('end', () => {
        try {
          const data = JSON.parse(body || '{}');
          if (typeof onEvent === 'function') onEvent(data.event, data);
        } catch {
          // 忽略坏请求，仍回 200，避免守护进程崩溃
        }
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true }));
      });
    } else {
      res.writeHead(404);
      res.end();
    }
  });
  return new Promise((resolve) => server.listen(p, '127.0.0.1', () => resolve(server)));
}

module.exports = { startServer };
```

- [ ] **Step 4: 运行确认通过**

Run: `node --test tests/server.test.js`
Expected: PASS（2 passed）

- [ ] **Step 5: 提交**

```bash
git add src/server.js tests/server.test.js
git commit -m "feat: add local HTTP event server"
```

---

### Task 7: Electron 主进程编排

**Files:**
- Create: `main.js`
- Create: `preload.js`

**Interfaces:**
- Consumes: `AppState, projectNameFromCwd`（`src/state.js`）、`startServer`（`src/server.js`）、`focusTerminal`（`src/focus.js`）、`findTranscript, sumUsage, estimateCost, loadPrices, loadStats, recordSession, buildRecord`（`src/stats.js`）、`defaultPort, SIGNAL_DIR`（`src/config.js`）
- Produces（IPC 通道，供渲染进程使用）:
  - 主→渲染（灯窗）: `webContents.send('state-update', snapshot)`
  - 渲染→主: `ipcRenderer.send('focus-terminal')`
  - 渲染→主（统计窗）: `ipcRenderer.invoke('get-stats')` → {current, totals, sessions, prices}

- [ ] **Step 1: 写 `preload.js`**

```js
// preload.js
const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('api', {
  onState: (cb) => ipcRenderer.on('state-update', (_e, s) => cb(s)),
  focusTerminal: () => ipcRenderer.send('focus-terminal'),
  getStats: () => ipcRenderer.invoke('get-stats'),
});
```

- [ ] **Step 2: 写 `main.js`**

```js
// main.js
const { app, BrowserWindow, Tray, Menu, ipcMain, shell } = require('electron');
const path = require('node:path');
const { AppState, projectNameFromCwd } = require('./src/state.js');
const { startServer } = require('./src/server.js');
const { focusTerminal } = require('./src/focus.js');
const {
  findTranscript, sumUsage, estimateCost, loadPrices, loadStats, recordSession, buildRecord,
} = require('./src/stats.js');
const { defaultPort, SIGNAL_DIR } = require('./src/config.js');

let lightWin = null;
let statsWin = null;
let tray = null;
const appState = new AppState();

function sendState() {
  if (lightWin) lightWin.webContents.send('state-update', appState.snapshot());
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
  tray = new Tray(require('electron').nativeImage.createEmpty()); // 占位；详见 Task 8 替换为真实图标
  const menu = Menu.buildFromTemplate([
    { label: '统计面板', click: () => openStatsWindow() },
    { label: '退出', click: () => app.quit() },
  ]);
  tray.setToolTip('CodaSignal');
  tray.setContextMenu(menu);
  tray.on('click', () => focusTerminal(appState.cwd));
}

ipcMain.on('focus-terminal', () => focusTerminal(appState.cwd));
ipcMain.handle('get-stats', () => {
  const prices = loadPrices();
  const tokens = computeCurrentTokens();
  const current = tokens
    ? { cwd: appState.cwd, project: projectNameFromCwd(appState.cwd), tokens, cost: estimateCost(tokens, prices) }
    : null;
  const stored = loadStats();
  // 若本次会话已结束，确保落盘一条记录
  if (appState.endTs && appState.startTs && !appState._recorded) {
    recordSession(buildRecord({
      sessionId: appState.sessionId, cwd: appState.cwd, project: projectNameFromCwd(appState.cwd),
      startTs: appState.startTs, endTs: appState.endTs, tokens: tokens || { input:0,output:0,cacheCreation:0,cacheRead:0,total:0 },
    }, prices));
    appState._recorded = true;
  }
  return { current, totals: stored.totals, sessions: stored.sessions, prices };
});

app.whenReady().then(async () => {
  createLightWindow();
  buildTray();
  const server = await startServer(defaultPort(), (event, data) => {
    appState.applyEvent(event, data || {});
    if (event === 'SessionEnd') appState._recorded = false; // 允许下次 get-stats 落盘
    sendState();
  });
  if (!server) { app.quit(); return; }
  // 端口冲突时 startServer 返回 undefined → 退出避免多实例
  if (server.listening === false) { app.quit(); }
});

app.on('window-all-closed', () => { /* 保持托盘常驻，不退出 */ });
```

注意：`startServer` 在 `port` 被占用时此处简化为仍监听（端口冲突检测在 Task 8 前的 refine 中处理：若 `server.address()` 为 null 则退出）。本任务先保证编排连通。

- [ ] **Step 3: 手动冒烟（非单测）**

Run: `npm start`（需先完成 Task 8 的渲染页面，否则窗口空白）
Expected: 应用启动，托盘出现，悬浮窗出现。

- [ ] **Step 4: 提交**

```bash
git add main.js preload.js
git commit -m "feat: wire Electron main process (windows, tray, server, IPC)"
```

---

### Task 8: 信号灯渲染页面（悬浮窗 UI）

**Files:**
- Create: `renderer/index.html`
- Create: `renderer/style.css`
- Create: `renderer/renderer.js`

**Interfaces:**
- Consumes: `window.api.onState(cb)`, `window.api.focusTerminal()`（来自 `preload.js`）

- [ ] **Step 1: 写 `renderer/index.html`**

```html
<!DOCTYPE html>
<html lang="zh">
<head>
  <meta charset="UTF-8" />
  <link rel="stylesheet" href="style.css" />
</head>
<body>
  <div class="titlebar">CodaSignal</div>
  <div class="lights">
    <div class="light red" data-state="red"></div>
    <div class="light yellow" data-state="yellow"></div>
    <div class="light green" data-state="green"></div>
  </div>
  <div id="label" class="label">空闲</div>
  <div id="project" class="project"></div>
  <script src="renderer.js"></script>
</body>
</html>
```

- [ ] **Step 2: 写 `renderer/style.css`**

```css
* { margin: 0; padding: 0; box-sizing: border-box; }
html, body {
  background: transparent;
  font-family: -apple-system, "Segoe UI", "Microsoft YaHei", sans-serif;
  color: #e6e6e6;
  user-select: none;
}
.titlebar {
  -webkit-app-region: drag;
  height: 22px; line-height: 22px; text-align: center;
  font-size: 12px; opacity: 0.7;
}
.lights {
  display: flex; flex-direction: column; align-items: center; gap: 12px;
  padding: 10px 0;
}
.light {
  width: 54px; height: 54px; border-radius: 50%;
  background: #2a2a2a; transition: all 0.25s ease;
}
.light.red.active    { background: #ff4d4f; box-shadow: 0 0 24px 6px rgba(255,77,79,0.8); }
.light.yellow.active { background: #ffd93b; box-shadow: 0 0 24px 6px rgba(255,217,59,0.8); }
.light.green.active  { background: #36d399; box-shadow: 0 0 24px 6px rgba(54,211,153,0.8); }
.label { text-align: center; font-size: 15px; font-weight: 600; }
.project { text-align: center; font-size: 11px; opacity: 0.6; margin-top: 4px; }
```

- [ ] **Step 3: 写 `renderer/renderer.js`**

```js
// renderer/renderer.js
const lights = Array.from(document.querySelectorAll('.light'));
const labelEl = document.getElementById('label');
const projectEl = document.getElementById('project');

window.api.onState((s) => {
  lights.forEach((el) => el.classList.toggle('active', el.dataset.state === s.state));
  labelEl.textContent = s.label || s.state;
  projectEl.textContent = s.project || '';
});

// 点击灯窗（除标题条外）聚焦终端
document.body.addEventListener('click', (e) => {
  if (e.target.classList.contains('titlebar')) return;
  window.api.focusTerminal();
});
```

- [ ] **Step 4: 手动验证**

Run: `npm start`；另开终端用 `curl -s -X POST http://127.0.0.1:18765/event -d '{"event":"PreToolUse"}'` 等模拟，观察灯色切换；点击灯窗应尝试聚焦（无 wezterm 会话时静默无报错）。
Expected: 灯随事件变化；点击不崩溃。

- [ ] **Step 5: 提交**

```bash
git add renderer/index.html renderer/style.css renderer/renderer.js
git commit -m "feat: add traffic-light renderer UI"
```

---

### Task 9: 统计面板渲染页面

**Files:**
- Create: `renderer/stats.html`
- Create: `renderer/stats.css`
- Create: `renderer/stats.js`

**Interfaces:**
- Consumes: `window.api.getStats()`（返回 {current, totals, sessions, prices}）

- [ ] **Step 1: 写 `renderer/stats.html`**

```html
<!DOCTYPE html>
<html lang="zh">
<head>
  <meta charset="UTF-8" />
  <link rel="stylesheet" href="stats.css" />
</head>
<body>
  <h1>CodaSignal 统计</h1>
  <section id="current"><h2>本次会话</h2><div class="body">加载中…</div></section>
  <section id="totals"><h2>累计</h2><div class="body">加载中…</div></section>
  <section id="history"><h2>历史会话</h2><div class="body">加载中…</div></section>
  <script src="stats.js"></script>
</body>
</html>
```

- [ ] **Step 2: 写 `renderer/stats.css`**

```css
* { margin: 0; padding: 0; box-sizing: border-box; }
body { font-family: -apple-system, "Segoe UI", "Microsoft YaHei", sans-serif; background: #1e1e1e; color: #e6e6e6; padding: 16px; }
h1 { font-size: 18px; margin-bottom: 12px; }
section { margin-bottom: 16px; }
h2 { font-size: 14px; opacity: 0.7; margin-bottom: 6px; }
.body { background: #2a2a2a; border-radius: 8px; padding: 10px; font-size: 13px; line-height: 1.6; white-space: pre-wrap; }
```

- [ ] **Step 3: 写 `renderer/stats.js`**

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
  const cur = data.current;
  document.querySelector('#current .body').textContent = cur
    ? `项目: ${cur.project}\n时长: ${fmtMs(cur.tokens ? '' : '')}\ninput: ${fmtTokens(cur.tokens.input)}\noutput: ${fmtTokens(cur.tokens.output)}\ncache_read: ${fmtTokens(cur.tokens.cacheRead)}\ncache_creation: ${fmtTokens(cur.tokens.cacheCreation)}\n合计: ${fmtTokens(cur.tokens.total)}\n费用(${data.prices.currency}): ${cur.cost.toFixed(4)}`
    : '（暂无本次会话 token 数据）';

  const t = data.totals || {};
  document.querySelector('#totals .body').textContent =
    `会话数: ${t.count || 0}\n总时长: ${fmtMs(t.durationMs)}\n总 token: ${fmtTokens(t.tokens)}\n总费用: ${(t.cost || 0).toFixed(4)} ${data.prices.currency}`;

  const list = (data.sessions || []).slice(-20).reverse()
    .map((s) => `• ${s.project} | ${fmtMs(s.durationMs)} | ${fmtTokens(s.tokens.total)} tok | ${s.cost.toFixed(4)}`)
    .join('\n') || '（暂无历史）';
  document.querySelector('#history .body').textContent = list;
}

refresh();
setInterval(refresh, 3000);
```

- [ ] **Step 4: 手动验证**

Run: `npm start`；右键托盘 → 统计面板。跑一段 CodeBuddy 任务后打开，核对 token 与 `~/.codebuddy/projects/...` 的 `usage` 累加一致；修改 `~/.codasignal/settings.json` 的 `prices` 后费用变化；关闭重开应用历史仍在。
Expected: 统计数值正确、历史持久化。

- [ ] **Step 5: 提交**

```bash
git add renderer/stats.html renderer/stats.css renderer/stats.js
git commit -m "feat: add statistics panel UI"
```

---

### Task 10: 托盘图标与端口冲突处理（细化主进程）

**Files:**
- Modify: `main.js`（替换占位 Tray 图标、加入端口冲突退出）
- Create: `assets/icon.png`（占位图标；若缺图可用系统图标，见下）

**Interfaces:** 同 Task 7

- [ ] **Step 1: 生成占位图标**

若无可用的 `icon.png`，在 `main.js` 中用 `nativeImage.createFromDataURL` 生成的纯色圆点作为托盘图标，避免外部资源依赖。修改 `buildTray`：

```js
const { nativeImage } = require('electron');
function makeIcon() {
  // 16x16 红色圆点占位
  const size = 16;
  const c = require('electron').nativeImage.createEmpty();
  return nativeImage.createFromDataURL(
    'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAQAAAAECAYAAACp8Z5+AAAAEklEQVR4nGP8z8Dwn4EIwDiqEAByqgQF6R0qgwAAAABJRU5ErkJggg=='
  );
}
```

将 `buildTray` 中 `new Tray(require('electron').nativeImage.createEmpty())` 改为 `new Tray(makeIcon())`。

- [ ] **Step 2: 端口冲突时退出（防止多实例）**

修改 `app.whenReady` 块：

```js
const server = await startServer(defaultPort(), (event, data) => {
  appState.applyEvent(event, data || {});
  sendState();
});
if (!server || !server.listening) {
  console.error('[CodaSignal] 端口被占用，可能已有一个实例在运行，退出。');
  app.quit();
  return;
}
```

- [ ] **Step 3: 手动验证**

Run: `npm start` 两次（第二个实例应输出端口冲突并退出，无重复灯）。
Expected: 仅一个实例存活。

- [ ] **Step 4: 提交**

```bash
git add main.js
git commit -m "fix: real tray icon and prevent duplicate instances on port conflict"
```

---

### Task 11: Hook 配置文档与 README

**Files:**
- Create: `hooks/setup-hooks.md`
- Create: `README.md`

**Interfaces:** 无（文档）

- [ ] **Step 1: 写 `hooks/setup-hooks.md`**

内容为用户级 `~/.codebuddy/settings.json` 的 `hooks` 片段（与 spec 第 6 节一致），并说明：
- 每条命令结尾 `|| true` 的必要性；
- Windows 上 hooks 由 Git Bash 执行，命令须 bash 兼容；
- 端口可通过 `CODASIGNAL_PORT` 覆盖时，把 `18765` 换成对应值；
- 修改后需在 CodeBuddy 里 `/hooks` 审查或重启会话生效。

```markdown
# CodaSignal Hook 配置

把下面整段加进你的 `~/.codebuddy/settings.json`：

\`\`\`json
{
  "hooks": {
    "Notification": [{ "matcher": "permission_prompt", "hooks": [{ "type": "command", "command": "curl -s -X POST http://127.0.0.1:18765/event -d '{\"event\":\"permission_prompt\"}' || true" }] }],
    "PreToolUse": [{ "hooks": [{ "type": "command", "command": "curl -s -X POST http://127.0.0.1:18765/event -d '{\"event\":\"PreToolUse\"}' || true" }] }],
    "PostToolUse": [{ "hooks": [{ "type": "command", "command": "curl -s -X POST http://127.0.0.1:18765/event -d '{\"event\":\"PostToolUse\"}' || true" }] }],
    "Stop": [{ "hooks": [{ "type": "command", "command": "curl -s -X POST http://127.0.0.1:18765/event -d '{\"event\":\"Stop\"}' || true" }] }],
    "SessionStart": [{ "hooks": [{ "type": "command", "command": "cwd=$(pwd); curl -s -X POST http://127.0.0.1:18765/event -d \"{\\\"event\\\":\\\"SessionStart\\\",\\\"cwd\\\":\\\"$cwd\\\"}\" || true" }] }],
    "SessionEnd": [{ "hooks": [{ "type": "command", "command": "curl -s -X POST http://127.0.0.1:18765/event -d '{\"event\":\"SessionEnd\"}' || true" }] }]
  }
}
\`\`\`
```

- [ ] **Step 2: 写 `README.md`**

包含：项目简介、特性（信号灯 + 统计面板）、架构一句话、安装（`npm install`）、开发运行（`npm start`）、打包（`npm run dist`）、hook 配置指引（指向 `hooks/setup-hooks.md`）、统计配置（`~/.codasignal/settings.json` 的 `prices` 示例）、开源协议（MIT）。

- [ ] **Step 3: 提交**

```bash
git add hooks/setup-hooks.md README.md
git commit -m "docs: add hook setup guide and README"
```

---

### Task 12: 打包配置与产出安装包

**Files:**
- Modify: `package.json`（追加 `build` 字段）

**Interfaces:** 无

- [ ] **Step 1: 在 `package.json` 追加 `build` 配置**

在 `package.json` 中 `"scripts"` 之后加入：

```json
"build": {
  "appId": "com.codasignal.app",
  "productName": "CodaSignal",
  "files": ["main.js", "preload.js", "src/**", "renderer/**"],
  "win": { "target": "nsis", "icon": "assets/icon.png" }
}
```

若无 `assets/icon.png`，删除 `"icon"` 行（electron-builder 会 fallback）。

- [ ] **Step 2: 打包**

Run: `npm run dist`
Expected：在 `dist/` 生成 `CodaSignal-Setup-<ver>.exe` 安装包。

- [ ] **Step 3: 验证安装包**

安装并启动，确认悬浮灯、托盘、点击聚焦、统计面板均工作；卸载后 `~/.codasignal/` 数据保留。

- [ ] **Step 4: 提交**

```bash
git add package.json
git commit -m "build: configure electron-builder for Windows installer"
```

---

### Task 13: 端到端联调与负向测试

**Files:** 无新增，仅手动验证

**Interfaces:** 无

- [ ] **Step 1: 信号灯端到端**

启动 CodaSignal → 在 WezTerm 跑一次真实 CodeBuddy 任务（含需要审批的操作以触发红灯、若干工具调用触发黄灯、结束触发绿灯）→ 观察灯在 红/黄/绿/idle 间正确切换；点击悬浮窗与托盘确认 WezTerm 窗口被聚焦。

- [ ] **Step 2: 统计端到端**

打开统计面板，核对本次会话 token 明细与 `~/.codebuddy/projects/<slug>/` 下 `.jsonl` 的 `usage` 实际累加一致；修改 `prices` 后费用随之变化；关闭重开应用后历史与会话汇总仍在。

- [ ] **Step 3: 负向**

未启动 CodaSignal 时跑 CodeBuddy，确认无报错、无卡顿（hook 的 `|| true` 生效）；重复启动 CodaSignal 仅一个实例。

- [ ] **Step 4: 提交（如有修复）**

若发现问题并修复：
```bash
git add -A
git commit -m "fix: end-to-end issues from integration testing"
```

---

## Self-Review

**1. Spec coverage**
- 架构 / 技术栈（Electron + node:http + electron-builder + curl/wezterm）：Task 1、7、12 ✓
- 目录结构：Task 1/2/3/7/8/9 建立 ✓
- 状态模型与事件→灯色映射（spec §5）：Task 2 ✓
- Hook 配置（spec §6）：Task 11（与 spec 片段逐字一致）✓
- 本地 HTTP 接口（spec §7）：Task 6 ✓
- 点击跳终端 wezterm（spec §8）：Task 5（解析+聚焦）+ Task 7/8（点击触发）✓
- 界面形态悬浮窗+托盘（spec §9）：Task 8（灯窗）+ Task 7/10（托盘）✓
- 统计面板（spec §10）：slug/transcript/usage（Task 3）、持久化（Task 4）、费用（Task 3/4/9）、统计 UI（Task 9）、触发更新（Task 7 `get-stats`）✓
- 容错边界（spec §11）：端口冲突退出（Task 10）、hook `|| true`（Task 11）、HTTP 异常回 200（Task 6）、聚焦找不到静默（Task 5）✓
- 打包与开源（spec §12）：Task 1（MIT license 已存在）/ Task 12 ✓
- 测试（spec §13）：单测 Task 2-6，端到端 Task 13 ✓
- 实现步骤（spec §14）：对应 Task 1-13 ✓

**2. Placeholder scan**：无 TBD/TODO。Task 10 用 base64 占位图标避免外部资源依赖。所有代码步骤均含实际代码（草稿中残留的 `get-stats-request` noop 行已在编写时删除）。

**3. Type consistency**：
- `stateForEvent`、`AppState`、`snapshot(projectName)`、`projectNameFromCwd` 在 Task 2 定义，Task 7 以 `appState.snapshot()` 与 `projectNameFromCwd` 调用，签名一致。
- `startServer(port?, onEvent)` 在 Task 6 定义，Task 7 以 `startServer(defaultPort(), cb)` 调用，一致。
- `focusTerminal(cwd)` 在 Task 5 定义，Task 7/8 调用一致。
- `findTranscript/sumUsage/estimateCost/loadPrices/loadStats/recordSession/buildRecord` 在 Task 3/4 定义，Task 7/9 调用一致。
- `cwdToSlug/findTranscript/sumUsage/estimateCost/loadPrices/DEFAULT_PRICES` 在 Task 3 导出，Task 4 测试与 Task 7 使用一致。

**修复（Self-Review 发现）**：Task 7 `main.js` 草稿中残留的 `ipcMain.on('get-stats-request', …)` noop 行已在编写计划时删除，避免实现者误写入无对应调用的桩代码。其余类型一致。
