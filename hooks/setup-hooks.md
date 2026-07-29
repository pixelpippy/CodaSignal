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
    "Stop": [
      { "hooks": [ { "type": "command", "command": "curl -s -X POST http://127.0.0.1:18765/event -d '{\"event\":\"Stop\"}' || true" } ] }
    ],
    "SessionStart": [
      { "hooks": [ { "type": "command", "command": "cwd=$(pwd); curl -s -X POST http://127.0.0.1:18765/event -d \"{\\\"event\\\":\\\"SessionStart\\\",\\\"cwd\\\":\\\"$cwd\\\"}\" || true" } ] }
    ],
    "SessionEnd": [
      { "hooks": [ { "type": "command", "command": "curl -s -X POST http://127.0.0.1:18765/event -d '{\"event\":\"SessionEnd\"}' || true" } ] }
    ]
  }
}
```

## 说明

- **每条命令结尾的 `|| true` 不可省略**：CodeBuddy 的 hook 如果返回非零退出码会中断执行；即使 CodaSignal 没启动（curl 连不上），`|| true` 也保证 hook 静默失败、不影响你的任务。
- **Windows 上 hooks 由 Git Bash 执行**：命令必须用 bash 语法（单引号、`$(pwd)`、变量 `$cwd` 等），不要写成 PowerShell/cmd。
- **端口覆盖**：如果你的 CodaSignal 用 `CODASIGNAL_PORT` 自定义了端口，把上面所有 `18765` 换成对应端口。
- **生效方式**：修改 `settings.json` 后，在 CodeBuddy 里 `/hooks` 审查或重启会话即可生效。

## 事件 → 灯色映射

| 事件 | 灯色 |
| --- | --- |
| `permission_prompt`（Notification） | 红（等待审批） |
| `PreToolUse` / `PostToolUse` | 黄（执行中） |
| `Stop` / `SessionStart` / `SessionEnd` | 绿 / 空闲 |
