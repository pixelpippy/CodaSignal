# 多 Agent 并发支持 + 优先级灯逻辑设计

- 日期：2026-08-03
- 状态：草案（待用户评审）
- 关联：`2026-07-30-codasignal-traffic-light-design.md`
- 取代：初版「仅写 hook 配置、代码零改动」方案（用户改为要求真正的优先级聚合 + 多 agent 并发）

## 1. 目标

1. 支持 **CodeBuddy / Claude Code / Codex** 多个 agent **并发**运行，红绿灯实时反映所有会话的综合状态。
2. 灯色按优先级聚合（用户确认的规则）：
   - **亮红优先**：任一活跃会话处于「等待审批」(red) → 灯红。
   - **无红则黄**：无红，但任一活跃会话「思考中/执行中」(yellow) → 灯黄。
   - **有绿即绿**：无红无黄，但存在已跑完一轮、在等下一条的会话(green) → 灯绿（idle 不把灯降级）。
   - **全无活跃会话** → 空闲。
3. 统计面板（`get-stats`）列出**所有活跃会话**的明细 + 底部汇总。
4. 点击信号灯 → 聚焦**最紧急**会话的终端（red > yellow > 最近活动）。
5. 悬浮灯面文字只显示**最紧急会话的项目名**。

## 2. 为什么需要改代码（与初版的关键差异）

初版认为三工具共享事件名、接收端工具无关，故「零代码改动」。但那只能处理**单实例单盏灯、单会话串行**。

现在用户要**并发多 agent + 优先级聚合**，必须：
- 按 `session_id` 区分不同会话（否则多工具事件会互相覆盖灯色）。
- 维护「每会话状态 → 聚合灯色」的两层模型。
- 统计/聚焦/灯面文字都要从「单个 AppState」改为「聚合 + 最紧急会话」。

因此本设计**包含 `src/state.js`、`main.js`、`renderer/*` 的代码改动**，外加仍需要的 hook 配置（让新工具把事件发过来）。

## 3. 事件映射（复用现有 EVENT_TO_STATE）

| hook 事件 | 单会话灯色 | 说明 |
|---|---|---|
| `permission_prompt` | 红 | 等待审批（CodeBuddy 事件名；Claude Code/Codex 用 `PreToolUse` 审批拦截） |
| `UserPromptSubmit` | 黄(思考中) | 模型开始思考的早期信号 |
| `PreToolUse` | 黄(执行中) | 工具调用前 |
| `PostToolUse` | 黄(执行中) | 工具调用后 |
| `Stop` | 绿 | 本轮完成、等下一条（仅当当前为黄/红才变绿，避免会话开始的占位 Stop 闪绿） |
| `SessionStart` | 空闲 | 会话开始，登记一个 session |
| `SessionEnd` | 空闲 | 会话结束，移出活跃集合 |

`AppState` 里已有的 `phase`（`thinking`/`executing`）区分「思考中/执行中」逻辑继续复用，对多会话同样适用。

## 4. Hook 配置（仍需：让 Codex / Claude Code 把事件发到本服务）

通用命令模板（Git Bash，转发 stdin 并强制补 `cwd`，`|| true` 保护）：

```bash
stdin=$(cat); body=$(printf '%s' "$stdin" | sed -E 's/[[:space:]]+$//; s/\}$//'); printf '%s,"cwd":"%s"}' "$body" "$PWD" | curl -s -X POST http://127.0.0.1:18765/event -d @- || true
```

- 模板必须原样转发 stdin 里的 `session_id` / `transcript_path` / `hook_event_name`，这是**多会话区分的关键字段**。
- 端口 `18765` 来自 `src/config.js` 的 `CODASIGNAL_PORT`。
- 各工具配置位置：
  - CodeBuddy：`~/.codebuddy/settings.json`（已存在，基线）
  - Claude Code：`~/.claude/settings.json`（结构同 CodeBuddy，合并保留已有项）
  - Codex：`~/.codex/hooks.json`（位置以 `codex` 文档为准；事件名一致）
- 需接入的事件：`SessionStart` / `UserPromptSubmit` / `PreToolUse` / `PostToolUse` / `Stop` / `SessionEnd`。

## 5. 核心设计：按会话追踪 + 聚合

### 5.1 `src/state.js` 改造

- 新增 `SessionState` 类（单会话），字段同现有 `AppState` 实例字段：`state` / `phase` / `cwd` / `sessionId` / `transcriptPath` / `startTs` / `endTs` / `lastUpdate`。其 `applyEvent` 逻辑复用现有 `AppState.applyEvent` 的单会话规则（含 Stop 的占位保护、phase 区分）。
- 新增 `StateManager` 类（聚合），持有 `sessions: Map<sessionId, SessionState>`：
  - `applyEvent(event, data)`：
    - 取 `sid = data.session_id || data.sessionId || (data.cwd ? 'cwd:'+data.cwd : 'default')`（session_id 缺失时的兜底 key，保证单工具仍可分会话；同工具并发缺 id 会合并，属已知边界）。
    - `SessionStart`：无则新建 `SessionState` 并登记；写入 cwd/sessionId/transcriptPath/startTs。
    - `SessionEnd`：标记该会话结束（从活跃集合移除或置 `ended=true`）。
    - 其它事件：取/建对应 `SessionState` 并调用其 `applyEvent`。
    - 返回 `sid`（供 `main.js` 做按会话落盘）。
  - `PRIORITY = { red:3, yellow:2, green:1, idle:0 }`。
  - `aggregateState()`：`max(PRIORITY[s.state])` 遍历**活跃**会话；结果即聚合灯色（自然满足「红>黄>绿>空闲」「有绿即绿」）。
  - `activeSessions()`：未结束的会话列表（`SessionEnd` 后标记为 ended 并从活跃集合排除）。
  - `getSession(sid)`：按 id 取 `SessionState`（落盘时回查用）。
  - `mostUrgent()`：按 `PRIORITY` 取最紧急会话，平手取 `lastUpdate` 最新者；返回其 cwd / project / sessionId 供聚焦与灯面文字。
  - `snapshot()`：返回 `{ state: aggregate, label, count: activeSessions().length, project: mostUrgent().project, cwd: mostUrgent().cwd, sessions: [...] }`。`label` 沿用现有 `STATE_LABELS` + phase 规则（按聚合态 + 最紧急会话的 phase 决定「思考中/执行中」）。
- 保留 `projectNameFromCwd` 导出（不变）。
- 向后兼容：单 CodeBuddy 会话时，`sessions` 只有一项，聚合 = 该项，行为与原 `AppState` 完全一致。

### 5.2 `main.js` 改造

- `const appState = new StateManager();`（变量名沿用，减少改动面）。
- `sendState()`：`appState.snapshot()` 已返回聚合态，托盘图标 `makeIcon(appState.state)` 改为 `appState.snapshot().state`；悬浮窗推送同一 snapshot（含 `project`/`count`）。
- 统计 `get-stats` handler：改为返回**所有活跃会话**的明细数组 `current: activeSessions().map(s => ({ sessionId, project, cwd, state, tokens: computeSessionTokens(s), cost, startTs, endTs }))`，再加 `totals: stored.totals` 与 `sessions: stored.sessions`（历史）、`prices`。`computeCurrentTokens` 改为 `computeSessionTokens(session)` 按单会话 `transcriptPath`/cwd 计算。
- 落盘：server 回调里 `const sid = appState.applyEvent(...)`；当 `event==='Stop'||'SessionEnd'` 且 `appState.getSession(sid)` 有 `startTs`，对该会话 `upsertSession(buildRecord({...该会话字段...}, prices))`。`src/stats.js` 的 `upsertSession` 已按 `cwd+startTs` 去重，多会话天然隔离，无需改。
- 点击聚焦：`ipcMain.on('focus-terminal', () => focusTerminal(appState.mostUrgentCwd?.() || appState.mostUrgent()?.cwd))`。
- hover 速览：显示最紧急会话的速览（沿用现有 `getStats` 取最紧急即可）。

### 5.3 渲染层 `renderer/*` 改造

- `index.html` + `renderer.js`：灯面文字改用 `snapshot.project`（最紧急项目名）；`count>1` 时可显示一个小的「×N」角标（可选，默认仅项目名，符合用户选择）。灯色仍按 `snapshot.state`。
- `stats.html` + `stats.js`：`get-stats` 现在返回 `current` 数组；渲染**每个活跃会话一行**（项目名 + state + tokens + 费用），底部展示 `totals` 汇总与历史 `sessions`。
- `hover.html` + `hover.js`：显示最紧急会话的速览；结构基本不变。
- `preload.js`：无需新增 IPC 通道；`state-update` 与 `get-stats` 的载荷结构变化由渲染层适配。

## 6. 测试

- `tests/state.test.js`：将 `AppState` 单测迁移/扩展为 `StateManager`：
  - 单会话行为与原 `AppState` 一致（回归）。
  - 多会话聚合：A 红 + B 绿 → 红；A 黄 + B 绿 → 黄；A 绿 + B idle → 绿；无会话 → 空闲。
  - `mostUrgent` 选择正确（红>黄>最近）。
- （已知 `tests/focus.test.js` 仍过时，与本任务无关，不处理。）

## 7. 风险与缓解

| 风险 | 缓解 |
|---|---|
| `session_id` 缺失/重复导致会话合并 | 兜底 key（cwd:/default）；已知边界，三工具均文档声明会带 session_id |
| Codex 不发出 `UserPromptSubmit` | 灯在 `PreToolUse` 才变黄，属可接受差异（同初版） |
| `transcript_path` 字段名在 Codex 不同 | `[DBG]` 日志验证；不可读降级为 cwd 目录最新 jsonl（`findTranscript`） |
| 聚合后 `get-stats` 渲染改动面较大 | 保持 IPC 通道不变，仅改载荷结构 + 渲染 |
| 多会话并发导致落盘/统计错乱 | `upsertSession` 按 `cwd+startTs` 隔离；按 sid 逐会话落盘 |

## 8. 验证标准

- 同时开 CodeBuddy + Claude Code + Codex 各一个会话：灯色随优先级规则变化（任一红→红；无红有黄→黄；都清闲→绿）。
- 单工具使用行为与原版完全一致（回归）。
- 统计面板列出所有活跃会话明细 + 汇总。
- 点击灯聚焦到最紧急会话的终端（`focusTerminal` 收到正确 cwd）。
- 灯面文字显示最紧急项目名。

## 9. 实现步骤（概览，详细见 writing-plans）

1. 改 `src/state.js`：`SessionState` + `StateManager` + 聚合/最紧急逻辑 + 导出。
2. 改 `main.js`：实例化 `StateManager`、聚合 snapshot、多会话 stats、按会话落盘、聚焦最紧急。
3. 改 `renderer/*`：灯面文字用最紧急项目名；stats 列表渲染；hover 适配。
4. 更新 `tests/state.test.js` 覆盖聚合 + 最紧急。
5. 更新 `hooks/setup-hooks.md`：新增 Claude Code / Codex 章节（含 session_id 转发提醒）。
6. 本地起应用，用多工具/多会话验证；必要时加 `[DBG]` 日志排查。
