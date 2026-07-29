# CodaSignal — CodeBuddy 桌面信号灯 设计文档

- 日期：2026-07-30
- 状态：已确认（待实现）
- 许可证：MIT（开源）

## 1. 概述

CodaSignal 是一个运行在 Windows 桌面上的小型常驻应用，作为 CodeBuddy CLI 的"交通信号灯"：用一盏红 / 黄 / 绿三色灯实时反映当前 CodeBuddy 会话的状态，并支持点击跳转到对应的 WezTerm 终端窗口。

### 目标

1. 在桌面上用一盏醒目的信号灯显示 CodeBuddy 的工作状态。
2. 红灯 = 需要审批；黄灯 = 正在执行任务；绿灯 = 本轮任务完成。
3. 点击信号灯（悬浮窗或托盘图标）能把运行 CodeBuddy 的 WezTerm 窗口拉到前台。
4. 技术上"好看 + 开发快 + 方便打包给别人 + 源代码开源"。
5. 对 CodeBuddy 的正常运行零侵入、零副作用。

### 非目标（YAGNI）

- 不支持多会话多盏灯（本期仅单会话、一盏灯）。
- 不做网络同步 / 远程监控。
- 不做历史日志面板、统计图表等额外功能。
- 不内置审批操作（只在灯上提示，审批仍在 CodeBuddy 原界面完成）。

## 2. 架构

```
CodeBuddy CLI
   │  hooks（Git Bash 中执行 curl 命令）
   ▼
CodaSignal 桌面应用 (Electron)
   ├─ 本地 HTTP 服务 (http://127.0.0.1:18765)
   ├─ 悬浮窗 (红/黄/绿三盏圆灯，置顶、半透明、可拖拽)
   ├─ 系统托盘图标 (随状态变色)
   └─ 点击处理：调用 wezterm cli 聚焦终端窗口
```

核心巧思：CodeBuddy 的 **hook 事件名本身已决定灯色**，因此 hook 命令不需要解析任何 JSON，只发一条固定内容的 `curl` 请求告知"发生了哪个事件"。唯一需要解析 JSON 的地方（查询 WezTerm 窗口）放在 Electron 主进程用 Node 完成——Node 原生支持 JSON，于是**全程不依赖 jq / python / 在 hooks 里调用 node**，运行依赖仅为 Git Bash 自带的 `curl` 和用户已安装的 `wezterm cli`。

## 3. 技术栈

| 关注点 | 选择 | 理由 |
|---|---|---|
| 桌面框架 | Electron | 界面用 Web 技术，最容易做到"好看"；打包给别人最成熟；MIT 开源友好 |
| 本地服务 | Node 内置 `http` 模块 | 零额外依赖 |
| 界面 | 原生 HTML / CSS / JS（无前端框架） | 保持轻量、开发快 |
| 打包 | `electron-builder` | 一键产出带安装向导的 `.exe` |
| 许可证 | MIT | 开源、无 copyleft 顾虑 |
| 聚焦终端 | `wezterm cli` | 用户终端为 WezTerm，自带 CLI 可按窗口 ID 聚焦 |

## 4. 目录结构

```
CodaSignal/
  package.json
  main.js              # 主进程：HTTP 服务 + 悬浮窗 + 托盘 + 点击聚焦
  preload.js           # 上下文桥接（如需）
  renderer/
    index.html         # 信号灯页面
    style.css          # 三盏灯样式 + 发光动画
    renderer.js        # 接收状态、更新灯色与文字
  hooks/
    setup-hooks.md      # 给用户看的 hook 配置说明（含下方 JSON）
  LICENSE              # MIT
  README.md            # 项目说明 + 安装/使用/打包步骤
  docs/superpowers/specs/2026-07-30-codasignal-traffic-light-design.md
```

## 5. 状态模型

应用维护的当前状态：

```ts
type State = "idle" | "red" | "yellow" | "green";
interface AppState {
  state: State;
  cwd?: string;        // 来自 SessionStart
  sessionId?: string;  // 预留，单会话本期未强依赖
  lastUpdate: number;  // 时间戳
}
```

### 事件 → 灯色映射（在 Electron 内完成）

| CodeBuddy 事件 | 灯色 | 含义 |
|---|---|---|
| `Notification` (permission_prompt) | 🔴 red | 需要你审批 |
| `PreToolUse` | 🟡 yellow | 正在执行任务 |
| `PostToolUse` | 🟡 yellow | 仍在执行（保持黄灯） |
| `Stop` | 🟢 green | 本轮任务完成 |
| `SessionStart` | ⚪ idle（记录 cwd） | 会话开始 / 空闲 |
| `SessionEnd` | ⚪ idle | 会话结束 / 空闲 |

悬浮窗文字随灯色变化：红→"等待审批"，黄→"执行中"，绿→"已完成"，idle→"空闲"。下方显示项目目录名（取自 `cwd` 的最后一级）。

## 6. Hook 配置

写入用户级 `~/.codebuddy/settings.json` 的 `hooks` 字段。每条 hook 仅执行一条 `curl`，结尾 `|| true` 保证守护进程未启动时不影响 CodeBuddy。

```jsonc
{
  "hooks": {
    "Notification": [
      {
        "matcher": "permission_prompt",
        "hooks": [
          {
            "type": "command",
            "command": "curl -s -X POST http://127.0.0.1:18765/event -d '{\"event\":\"permission_prompt\"}' || true"
          }
        ]
      }
    ],
    "PreToolUse": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "curl -s -X POST http://127.0.0.1:18765/event -d '{\"event\":\"PreToolUse\"}' || true"
          }
        ]
      }
    ],
    "PostToolUse": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "curl -s -X POST http://127.0.0.1:18765/event -d '{\"event\":\"PostToolUse\"}' || true"
          }
        ]
      }
    ],
    "Stop": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "curl -s -X POST http://127.0.0.1:18765/event -d '{\"event\":\"Stop\"}' || true"
          }
        ]
      }
    ],
    "SessionStart": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "cwd=$(pwd); curl -s -X POST http://127.0.0.1:18765/event -d \"{\\\"event\\\":\\\"SessionStart\\\",\\\"cwd\\\":\\\"$cwd\\\"}\" || true"
          }
        ]
      }
    ],
    "SessionEnd": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "curl -s -X POST http://127.0.0.1:18765/event -d '{\"event\":\"SessionEnd\"}' || true"
          }
        ]
      }
    ]
  }
}
```

> 说明：hooks 在 Windows 上由 CodeBuddy 强制用 Git Bash 执行，因此命令必须是 bash 兼容语法；`curl` 为 Git Bash 自带。

## 7. 本地 HTTP 接口

- `POST /event`
  - 请求体：`{"event": "<事件名>", "cwd"?: "<工作目录>"}`
  - 行为：按第 5 节的映射更新 `AppState`；若是 `SessionStart` 则记录 `cwd`；随后通过 Electron IPC 通知渲染进程刷新灯色、更新托盘图标。
  - 响应：`200 {"ok":true}`。任何请求都不应导致守护进程崩溃（异常时返回 200 并记录日志）。

端口默认 `18765`，可通过环境变量 `CODASIGNAL_PORT` 覆盖。

## 8. 点击跳转到终端（WezTerm）

1. `SessionStart` 时 Electron 记录 `cwd`。
2. 用户点击悬浮窗或托盘图标时，主进程执行聚焦逻辑：
   1. 运行 `wezterm cli list-panes --format json`，用 Node `JSON.parse` 解析。
   2. 找到 `cwd` 与记录值匹配的窗格（取首个匹配；单会话下通常唯一），读取其 `window_id`。
   3. 运行 `wezterm cli activate-window --window-id <id>` 将该 WezTerm 窗口拉到前台。
3. 若找不到匹配窗口（如终端已关闭），静默忽略，不影响应用。

> 备选：若 `activate-window` 不可用，退而用 Windows API（`user32 SetForegroundWindow`）按窗口标题匹配；本期以 `wezterm cli` 为主路径。

## 9. 界面形态

- **悬浮窗**：桌角一个永远置顶（`alwaysOnTop`）的小窗口，半透明、可拖拽；渲染三盏圆灯（红/黄/绿），当前状态那盏点亮并发光（CSS `box-shadow` 辉光动画），其余暗淡。下方一行状态文字 + 项目目录名。点击窗口任意处触发聚焦终端。
- **系统托盘图标**：常驻托盘，图标颜色随状态变化；点击托盘图标同样触发聚焦终端；关闭悬浮窗后托盘仍在，可从托盘恢复窗口。

## 10. 容错与边界

- **守护进程未启动**：hook 的 `|| true` 吞掉 curl 错误，CodeBuddy 完全不受影响。
- **端口被占用（应用重复启动）**：Electron 绑定失败时报错并退出，避免多实例互相覆盖状态。
- **单会话语义**：全局一个端口，后到的事件覆盖状态，符合"只一盏灯"。
- **窗口已关**：聚焦时找不到窗口则静默忽略。
- **HTTP 异常**：任意请求出错都返回 200，守护进程不崩。

## 11. 打包与开源

- `npm run dist` 经 `electron-builder` 产出带安装向导的 `.exe` 安装包，他人双击即用。
- 仓库初始化 git，根目录含 `MIT LICENSE`、`README.md`（含 hook 配置步骤与打包命令）。
- 源码全部以 MIT 许可证开源。

## 12. 测试

- **单元 / 接口**：用 `curl` 直接打 `POST /event` 模拟各事件，验证灯色、托盘、文字随映射正确变化。
- **端到端**：启动 CodaSignal → 跑一次真实 CodeBuddy 任务，观察灯在 红/黄/绿/idle 间正确切换；点击悬浮窗与托盘，确认对应 WezTerm 窗口被聚焦。
- **负向**：在未启动 CodaSignal 时跑 CodeBuddy，确认无报错、无卡顿。

## 13. 实现步骤（建议顺序）

1. 初始化仓库、`package.json`、MIT LICENSE、目录骨架。
2. Electron 主进程：建悬浮窗 + 托盘 + 本地 HTTP 服务，实现 `/event` 与状态映射。
3. 渲染进程：三盏灯 UI + 发光动画 + 状态文字。
4. 点击聚焦：接入 `wezterm cli` 逻辑。
5. 编写 `hooks/setup-hooks.md` 与 `README.md`，给出 `~/.codebuddy/settings.json` 的 hook 片段。
6. 配置 `electron-builder`，产出 `.exe` 安装包。
7. 端到端联调与负向测试。
