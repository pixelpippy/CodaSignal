# CodaSignal Hook 配置

把下面整段加进你的 `~/.codebuddy/settings.json`（或合并进已有的 `hooks` 字段）：

```json
{
  "hooks": {
    "Notification": [
      { "matcher": "permission_prompt", "hooks": [ { "type": "command", "command": "curl -s -X POST http://127.0.0.1:18765/event -d '{\"event\":\"permission_prompt\"}' || true" } ] }
    ],
    "PreToolUse": [
      { "hooks": [ { "type": "command", "command": "curl -s -X POST http://127.0.0.1:18765/event -d '{\"event\":\"PreToolUse\"}' || true" } ] }
    ],
    "PostToolUse": [
      { "hooks": [ { "type": "command", "command": "curl -s -X POST http://127.0.0.1:18765/event -d '{\"event\":\"PostToolUse\"}' || true" } ] }
    ],
    "UserPromptSubmit": [
      { "hooks": [ { "type": "command", "command": "stdin=$(cat); body=$(printf '%s' \"$stdin\" | sed -E 's/[[:space:]]+$//; s/\\}$//'); printf '%s,\"cwd\":\"%s\"}' \"$body\" \"$PWD\" | curl -s -X POST http://127.0.0.1:18765/event -d @- || true" } ] }
    ],
    "Stop": [
      { "hooks": [ { "type": "command", "command": "curl -s -X POST http://127.0.0.1:18765/event -d '{\"event\":\"Stop\"}' || true" } ] }
    ],
    "SessionStart": [
      { "hooks": [ { "type": "command", "command": "stdin=$(cat); body=$(printf '%s' \"$stdin\" | sed -E 's/[[:space:]]+$//; s/\\}$//'); printf '%s,\"cwd\":\"%s\"}' \"$body\" \"$PWD\" | curl -s -X POST http://127.0.0.1:18765/event -d @- || true" } ] }
    ],
    "SessionEnd": [
      { "hooks": [ { "type": "command", "command": "curl -s -X POST http://127.0.0.1:18765/event -d '{\"event\":\"SessionEnd\"}' || true" } ] }
    ]
  }
}
```

## 说明

- **每条命令结尾的 `|| true` 不可省略**：CodeBuddy 的 hook 如果返回非零退出码会中断执行；即使 CodaSignal 没启动（curl 连不上），`|| true` 也保证 hook 静默失败、不影响你的任务。
- **`SessionStart` 如何拿到项目目录**：CodeBuddy 会把本次会话信息（含 `session_id`、`transcript_path`、`hook_event_name`）以 **JSON 打到 hook 的 stdin**，而不是 shell 的工作目录。上面的命令把这个 stdin 原样转发给 CodaSignal，并用 `$PWD`（hook 执行时已是项目目录）注入 `cwd` 字段。这样**不依赖 `$(pwd)` 解析**，也不受 Git Bash 路径格式影响。
- **Windows 上 hooks 由 Git Bash 执行**：命令必须用 bash 语法（单引号、命令替换 `$(...)`、变量 `$PWD` 等），不要写成 PowerShell/cmd。
- **`UserPromptSubmit` 是“思考开始”的早期信号**：它在用户提交消息后、CodeBuddy 开始处理前触发（内部命令如 `/hooks` 除外），让红绿灯在**你按下发送的那一刻**就变黄，而不是等到模型第一次调用工具（`PreToolUse`）才亮——避免出现“空闲→思考”延迟一步的问题。它同样转发 stdin 并注入 `$PWD`，所以也会刷新 `cwd`。
- **端口覆盖**：如果你的 CodaSignal 用 `CODASIGNAL_PORT` 自定义了端口，把上面所有 `18765` 换成对应端口。
- **生效方式**：修改 `settings.json` 后，在 CodeBuddy 里 `/hooks` 审查或重启会话即可生效。

## 事件 → 灯色映射

| 事件 | 灯色 |
| --- | --- |
| `permission_prompt`（Notification） | 红（等待审批） |
| `UserPromptSubmit` | 黄（思考中）—— 用户一发消息、CodeBuddy 开始处理前即触发，让灯**不延迟**地亮起 |
| `PreToolUse` / `PostToolUse` | 黄（执行中） |
| `Stop` / `SessionStart` / `SessionEnd` | 绿 / 空闲 |
