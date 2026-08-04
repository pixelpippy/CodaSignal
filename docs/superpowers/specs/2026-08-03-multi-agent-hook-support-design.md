# 多 Agent Hook 支持设计（Codex / Claude Code 复用现有灯逻辑）

- 日期：2026-08-03
- 状态：草案（待用户评审）
- 关联：`2026-07-30-codasignal-traffic-light-design.md`

## 1. 背景与目标

CodaSignal 当前通过 CodeBuddy 的 hook 系统接收事件（`~/.codebuddy/settings.json` 里配置 hook，由 Git Bash 执行 `curl` 把事件 POST 到本地 `127.0.0.1:18765/event`）。

用户希望红绿灯也能反映另外两款 agent 工具的状态：

- **OpenAI Codex**（Codex CLI）
- **Claude Code**（Anthropic 官方 CLI）

经探索与设计澄清，结论如下：

- 这三款工具**共享完全相同的 hook 事件名**（`SessionStart` / `UserPromptSubmit` / `PreToolUse` / `PostToolUse` / `Stop` / `SessionEnd` / `Notification`），且都通过 shell 命令的 **stdin** 传入 `{ session_id, transcript_path, cwd, hook_event_name, permission_mode }` 这一结构。
- CodaSignal 的接收端（`src/server.js`）已做到工具无关：`const event = data.event || data.hook_event_name;`——任何工具只要把事件 POST 到同一个端口，逻辑无需改动即可工作。
- 用户**不会同时运行三种工具**，亮灯逻辑保持现状：亮红优先，无红则黄，全绿才绿（单实例 `AppState`，单端口单盏灯）。

因此本设计的唯一交付物是：**为 Codex 与 Claude Code 编写与 CodeBuddy 等价的 hook 配置，把它们发出的事件转发到 CodaSignal 已有的本地服务**，应用代码与 UI 零改动。

## 2. 非目标（明确不做）

- 不新增多任务 / 多窗口 UI。用户明确不会三工具并行，单盏灯逻辑保持不变。
- 不在事件里加 `source` / `tool` 字段，也不做"按工具聚合成多盏灯"的优先级灯。
- 不改动 `src/` 下任何模块（`server.js` / `state.js` / `stats.js` / `focus.js` / `config.js`）。
- 不支持 macOS / Linux（CodaSignal 仍仅 Windows：PowerShell 聚焦、无边框窗口 DWM 处理）。

## 3. 事件映射（复用现有逻辑）

所有工具的事件都映射到同一套灯色（来自 `src/state.js` 的 `EVENT_TO_STATE`）：

| hook 事件 | 灯色 | 标签 | 备注 |
|---|---|---|---|
| `permission_prompt` | 红 | 等待审批 | CodeBuddy 专属事件名；Codex/Claude Code 用 `PreToolUse` 审批拦截 |
| `UserPromptSubmit` | 黄 | 思考中 | "思考开始" 早期信号，消除空闲→黄灯的延迟 |
| `PreToolUse` | 黄 | 执行中 | 工具调用前 |
| `PostToolUse` | 黄 | 执行中 | 工具调用后 |
| `Stop` | 绿 | 已完成 | |
| `SessionStart` | 空闲 | 空闲 | |
| `SessionEnd` | 空闲 | 空闲 | 落盘历史统计 |

> 注意：`UserPromptSubmit` → 黄（思考中），`PreToolUse`/`PostToolUse` → 黄（执行中），二者在 `AppState` 里通过 `phase` 字段区分标签，逻辑已在 `state.js` 实现，新工具自动受益。

## 4. Hook 配置模板（关键）

三款工具都需要在 hook 命令里做两件事：

1. 把 stdin 原样读取（含 `session_id` / `transcript_path` / `cwd` / `hook_event_name` 等字段）。
2. 由于 CodeBuddy/Claude Code 传入的 JSON 里**可能没有 `cwd` 字段**（尤其早期 `cwd=undefined` 问题），在 JSON 末尾追加 `"cwd":"$PWD"` 以补全省略的工作目录——这是之前修复 CodeBuddy 统计归零问题的关键。

通用命令模板（在 Git Bash 下执行，Windows 路径用正斜杠）：

```bash
stdin=$(cat); body=$(printf '%s' "$stdin" | sed -E 's/[[:space:]]+$//; s/\}$//'); printf '%s,"cwd":"%s"}' "$body" "$PWD" | curl -s -X POST http://127.0.0.1:18765/event -d @- || true
```

- `sed` 去掉末尾空白并把结尾的 `}` 去掉，再用 `printf` 拼上 `,"cwd":"$PWD"}` 形成合法 JSON。
- `|| true` 保证 CodaSignal 未启动 / 网络异常时**不中断 agent 流程**。
- 端口 `18765` 来自 `src/config.js` 的 `CODASIGNAL_PORT`（默认 `18765`）。

## 5. 各工具配置位置与写法

### 5.1 CodeBuddy（已存在，记录基线）

配置文件：`~/.codebuddy/settings.json`

```json
{
  "hooks": {
    "SessionStart": [
      { "hooks": [ { "type": "command", "command": "<上面的通用模板>" } ] }
    ],
    "UserPromptSubmit": [
      { "hooks": [ { "type": "command", "command": "<上面的通用模板>" } ] }
    ],
    "PreToolUse": [
      { "hooks": [ { "type": "command", "command": "<上面的通用模板>" } ] }
    ],
    "PostToolUse": [
      { "hooks": [ { "type": "command", "command": "<上面的通用模板>" } ] }
    ],
    "Stop": [
      { "hooks": [ { "type": "command", "command": "<上面的通用模板>" } ] }
    ],
    "SessionEnd": [
      { "hooks": [ { "type": "command", "command": "<上面的通用模板>" } ] }
    ]
  }
}
```

### 5.2 Claude Code

配置文件：`~/.claude/settings.json`（结构同 CodeBuddy）

需新增/合并的 hook 事件：`SessionStart`、`UserPromptSubmit`、`PreToolUse`、`PostToolUse`、`Stop`、`SessionEnd`，命令均用第 4 节的通用模板。合并时保留文件里已有的其它配置项（不要整体覆盖）。

### 5.3 OpenAI Codex

Codex CLI 的 hook 配置通常为 `hooks.json`，预期位置 `~/.codex/hooks.json`（如实际位置不同，以 `codex` 文档为准）。事件名与上面一致。命令同样用第 4 节通用模板。

> 注意：Codex 的事件结构与字段名需以实际运行验证为准（见第 7 节风险）。若 Codex 不发出 `UserPromptSubmit`，则"思考中"早期信号对 Codex 缺失，灯会在 `PreToolUse` 才变黄——属已知可接受差异。

## 6. 写入本机配置的步骤（实现阶段）

1. 读取各工具的现有配置文件（如不存在则新建）。
2. 把第 4 节通用模板填入每个需要的事件数组（命令字符串里的双引号需用 JSON 转义为 `\"`）。
3. 校验生成的 JSON 合法（`node -e "JSON.parse(require('fs').readFileSync(path,'utf8'))"`）。
4. 重启对应 agent 工具使配置生效。
5. 触发一次会话，观察 CodaSignal 灯色变化与 `stats.js` 能读到 `transcript_path`。
6. 更新仓库内的 `hooks/setup-hooks.md`：在现有 CodeBuddy 章节之外，新增「Claude Code」与「OpenAI Codex」两节，给出各自配置文件路径与第 4 节通用模板，并说明合并而非覆盖现有配置。

## 7. 风险与缓解

| 风险 | 缓解 |
|---|---|
| Git Bash shell 兼容：模板依赖 `sed` / `$PWD` / 命令替换，需用户机器装了 Git Bash 且在 PATH | 模板与 CodeBuddy 现有 hook 同源，已验证可用 |
| `transcript_path` 在 Codex 中字段名/可用性不同 | 实现后用 `[DBG]` 日志验证；不可读则降级为 cwd 目录最新 jsonl（现有 `findTranscript` 逻辑） |
| `cwd` 缺失 | 模板强制追加 `"cwd":"$PWD"` |
| 三工具配置结构不同（settings.json vs hooks.json） | 逐工具核对实际文件结构后再写 |
| 多个 agent 同时运行抢同一盏灯 | 用户明确不并行；单实例单端口不变 |
| 配置写错导致 agent 启动失败 | 每次写入后 JSON 校验 + `|| true` 保护 |

## 8. 验证标准

- 在 Claude Code / Codex 各发起一次会话：CodaSignal 灯色应按第 3 节映射变化（黄→绿/空闲）。
- `UserPromptSubmit` 出现时（Claude Code）灯应尽早变黄（思考中）。
- `get-stats` 能拿到非空 `transcriptPath` 与非零 tokens（取决于该会话是否产生 usage）。
- CodaSignal 未启动时，agent 流程不受影响（`|| true` 兜底）。
- 应用代码与 UI 无改动。`~/.claude/settings.json`、`~/.codex/hooks.json` 等机器配置在仓库之外，不进 git；仓库内 `git diff --stat` 仅含文档改动（本 spec 与 `hooks/setup-hooks.md`）。
