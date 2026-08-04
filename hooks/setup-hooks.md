# CodaSignal Hook 配置

## 通用模板

所有事件、所有工具（CodeBuddy / Claude Code / Codex）都用**同一条命令**，不要给某些事件写「简化版」的字面量 JSON：

```bash
stdin=$(cat); body=$(printf '%s' "$stdin" | sed -E 's/[[:space:]]+$//; s/\}$//'); printf '%s,"cwd":"%s"}' "$body" "$PWD" | curl -s -X POST http://127.0.0.1:18765/event -d @- || true
```

它做三件事：

1. 读取 hook 的 stdin（工具给出的 JSON，含 `session_id` / `transcript_path` / `hook_event_name`）；
2. 去掉结尾的 `}` 后拼上 `"cwd":"$PWD"`，把项目目录注入进去；
3. POST 给 CodaSignal，末尾 `|| true` 保证 hook 永不失败。

> **必须每个事件都用这条模板。** CodaSignal 靠 `session_id` 区分并发会话：如果某个事件（比如 `Stop` / `SessionEnd`）发的是不带 `session_id` 的字面量 JSON，它会被算成另一个「幽灵会话」，导致真正的会话收不到 `Stop`/`SessionEnd`——灯不变绿、不回空闲，`stats.json` 也不再记录。

写进 JSON 配置时，命令里的双引号要转义成 `\"`，反斜杠要写成 `\\`（下方配置块已经是转义好的成品，可直接复制）。

## CodeBuddy

把下面整段加进你的 `~/.codebuddy/settings.json`（或合并进已有的 `hooks` 字段）：

```json
{
  "hooks": {
    "Notification": [
      { "matcher": "permission_prompt", "hooks": [ { "type": "command", "command": "stdin=$(cat); body=$(printf '%s' \"$stdin\" | sed -E 's/[[:space:]]+$//; s/\\}$//'); printf '%s,\"cwd\":\"%s\"}' \"$body\" \"$PWD\" | curl -s -X POST http://127.0.0.1:18765/event -d @- || true" } ] }
    ],
    "PreToolUse": [
      { "hooks": [ { "type": "command", "command": "stdin=$(cat); body=$(printf '%s' \"$stdin\" | sed -E 's/[[:space:]]+$//; s/\\}$//'); printf '%s,\"cwd\":\"%s\"}' \"$body\" \"$PWD\" | curl -s -X POST http://127.0.0.1:18765/event -d @- || true" } ] }
    ],
    "PostToolUse": [
      { "hooks": [ { "type": "command", "command": "stdin=$(cat); body=$(printf '%s' \"$stdin\" | sed -E 's/[[:space:]]+$//; s/\\}$//'); printf '%s,\"cwd\":\"%s\"}' \"$body\" \"$PWD\" | curl -s -X POST http://127.0.0.1:18765/event -d @- || true" } ] }
    ],
    "UserPromptSubmit": [
      { "hooks": [ { "type": "command", "command": "stdin=$(cat); body=$(printf '%s' \"$stdin\" | sed -E 's/[[:space:]]+$//; s/\\}$//'); printf '%s,\"cwd\":\"%s\"}' \"$body\" \"$PWD\" | curl -s -X POST http://127.0.0.1:18765/event -d @- || true" } ] }
    ],
    "Stop": [
      { "hooks": [ { "type": "command", "command": "stdin=$(cat); body=$(printf '%s' \"$stdin\" | sed -E 's/[[:space:]]+$//; s/\\}$//'); printf '%s,\"cwd\":\"%s\"}' \"$body\" \"$PWD\" | curl -s -X POST http://127.0.0.1:18765/event -d @- || true" } ] }
    ],
    "SessionStart": [
      { "hooks": [ { "type": "command", "command": "stdin=$(cat); body=$(printf '%s' \"$stdin\" | sed -E 's/[[:space:]]+$//; s/\\}$//'); printf '%s,\"cwd\":\"%s\"}' \"$body\" \"$PWD\" | curl -s -X POST http://127.0.0.1:18765/event -d @- || true" } ] }
    ],
    "SessionEnd": [
      { "hooks": [ { "type": "command", "command": "stdin=$(cat); body=$(printf '%s' \"$stdin\" | sed -E 's/[[:space:]]+$//; s/\\}$//'); printf '%s,\"cwd\":\"%s\"}' \"$body\" \"$PWD\" | curl -s -X POST http://127.0.0.1:18765/event -d @- || true" } ] }
    ]
  }
}
```

## 说明

- **每条命令结尾的 `|| true` 不可省略**：CodeBuddy 的 hook 如果返回非零退出码会中断执行；即使 CodaSignal 没启动（curl 连不上），`|| true` 也保证 hook 静默失败、不影响你的任务。
- **项目目录从哪来**：CodeBuddy 会把本次会话信息（含 `session_id`、`transcript_path`、`hook_event_name`）以 **JSON 打到 hook 的 stdin**，而不是 shell 的工作目录。模板把这个 stdin 原样转发给 CodaSignal，并用 `$PWD`（hook 执行时已是项目目录）注入 `cwd` 字段。这样**不依赖 `$(pwd)` 解析**，也不受 Git Bash 路径格式影响。
- **`session_id` 必须每个事件都带**：CodaSignal 按 `session_id` 维护多会话状态并聚合灯色。缺 `session_id` 的事件会落到「最近活跃会话」兜底逻辑上，多会话并发时可能张冠李戴——所以别偷懒改成字面量 JSON。
- **Windows 上 hooks 由 Git Bash 执行**：命令必须用 bash 语法（单引号、命令替换 `$(...)`、变量 `$PWD` 等），不要写成 PowerShell/cmd。
- **`UserPromptSubmit` 是“思考开始”的早期信号**：它在用户提交消息后、CodeBuddy 开始处理前触发（内部命令如 `/hooks` 除外），让红绿灯在**你按下发送的那一刻**就变黄，而不是等到模型第一次调用工具（`PreToolUse`）才亮——避免出现“空闲→思考”延迟一步的问题。
- **端口覆盖**：如果你的 CodaSignal 用 `CODASIGNAL_PORT` 自定义了端口，把上面所有 `18765` 换成对应端口。
- **生效方式**：修改 `settings.json` 后，在 CodeBuddy 里 `/hooks` 审查或重启会话即可生效。

## 事件 → 灯色映射

| 事件 | 灯色 |
| --- | --- |
| `permission_prompt`（Notification） | 红（等待审批） |
| `UserPromptSubmit` | 黄（思考中）—— 用户一发消息、CodeBuddy 开始处理前即触发，让灯**不延迟**地亮起 |
| `PreToolUse` / `PostToolUse` | 黄（执行中） |
| `Stop` / `SessionStart` / `SessionEnd` | 绿 / 空闲 |

## Claude Code

配置文件：`~/.claude/settings.json`（结构同 CodeBuddy 的 `hooks` 块）。对以下事件各加一个 command hook，命令均用上方「通用模板」：

- `SessionStart`、`UserPromptSubmit`、`PreToolUse`、`PostToolUse`、`Stop`、`SessionEnd`

注意：Claude Code 会在 stdin 的 JSON 中给出 `session_id` / `transcript_path` / `cwd` / `hook_event_name`，**务必原样转发**（模板已处理），CodaSignal 靠 `session_id` 区分并发会话。合并时保留文件已有其它配置项，勿整体覆盖。JSON 内双引号需转义为 `\"`。

## OpenAI Codex

Codex CLI 的 hook 配置通常为 `hooks.json`，预期位置 `~/.codex/hooks.json`（以 `codex` 文档为准；事件名与上面一致）。命令同样用「通用模板」。**若 Codex 不发出 `UserPromptSubmit`，灯会在 `PreToolUse` 才变黄**，属已知可接受差异。
