# CODEBUDDY.md

This file provides guidance to CodeBuddy Code when working with code in this repository.

## 项目概览

CodaSignal 是一个 **Windows 专属的 Electron 桌面应用**，用红/黄/绿三盏信号灯实时反映 CodeBuddy CLI 会话状态，点击信号灯可把对应终端提到前台，并提供统计面板展示 token 用量、时长与费用估算（含跨会话历史）。

整套机制依赖 CodeBuddy 的 hook 系统：在 `~/.codebuddy/settings.json` 里配置 hook，由 Git Bash 执行 `curl` 把事件 POST 到本应用的本地 HTTP 服务。配置方法见 `hooks/setup-hooks.md`。

## 常用命令

```bash
npm install        # 安装依赖（含 electron / electron-builder，Windows 下可能需能访问 Electron 发布源）
npm start          # 以 electron . 启动应用（任务栏托盘 + 右上角悬浮信号灯）
npm run dist       # electron-builder 打包，在 dist/ 生成 NSIS 安装包 CodaSignal-Setup-<ver>.exe
npm test           # 运行全部测试（node --test，Node 内置测试运行器，非 jest）
```

运行单个测试文件（Node 内置测试器按文件执行）：

```bash
node --test tests/state.test.js
node --test tests/stats.test.js
```

> 注意：当前 `tests/focus.test.js` 是**过时**的，引用了已不存在的 `parsePanes` / `findWindowIdForCwd` / 基于 `wezterm cli` 的实现（见下方“已知问题”）。直接 `npm test` 会在这个文件上失败，但这不代表其它模块有问题。

没有 lint / 类型检查步骤；代码是纯 CommonJS（`require`/`module.exports`），无打包/转译步骤（`main.js`、`preload.js`、`src/**`、`renderer/**` 直接被 Electron 加载）。

## 架构

### 进程与模块边界

- **主进程 `main.js`**：应用入口。负责创建并管理全部窗口、托盘、本地 HTTP 服务，并在收到 hook 事件后驱动状态与 UI。
- **`src/`**：纯逻辑模块，全部被主进程 `require`，不依赖 Electron 渲染环境：
  - `config.js` —— 端口（`CODASIGNAL_PORT`，默认 `18765`）、`PROJECTS_DIR`（CodeBuddy 会话目录，默认 `~/.codebuddy/projects`）、`SIGNAL_DIR`（默认 `~/.codasignal`）。
  - `state.js` —— `SessionState`（单会话状态机）+ `StateManager`（持有 `Map<sessionId, SessionState>` 做多会话聚合）、`EVENT_TO_STATE` 映射（事件 → 灯色）、`PRIORITY`（`red>yellow>green>idle`）、`projectNameFromCwd` 取项目名。
  - `server.js` —— `startServer(port, onEvent)`：在 `127.0.0.1:PORT` 监听 `POST /event`，解析 JSON 后回调 `onEvent(event, data)`；端口被占用（EADDRINUSE）时返回 `null`。
  - `focus.js` —— `focusTerminal(cwd)`：通过 PowerShell 调用 `user32` 的 `AttachThreadInput`+`SetForegroundWindow` 把终端提到前台（绕过 Windows 前台锁）。候选终端进程名在 `TERMINAL_NAMES`（`wezterm`/`WindowsTerminal`/`conhost`/`mintty`）。
  - `stats.js` —— token 统计与费用估算核心（见下）。
- **`preload.js`**：唯一暴露给渲染进程的桥（`contextBridge`），挂到 `window.api`。使用 `contextIsolation: true` + `nodeIntegration: false`，所有 Node/Electron 能力必须经 IPC 暴露。
- **`renderer/`**：三个无框架的静态页面（原生 DOM + CSS），通过 `window.api` 与主进程通信：
  - `index.html` + `renderer.js` —— 信号灯悬浮窗（三盏灯 + 标签 + 项目名）。
  - `stats.html` + `stats.js` —— 统计面板窗口（本次/累计/历史会话）。
  - `hover.html` + `hover.js` —— 悬停信号灯时弹出的侧边小统计窗。

### 事件 → 状态 → UI 的数据流

1. CodeBuddy hook（Git Bash 里的 `curl`）向 `POST /event` 发送 `{"event": "...", ...}`。
2. `src/server.js` 解析后回调主进程传入的 `onEvent`（`main.js` 内）。
3. `StateManager.applyEvent(event, data)` 按 `session_id`（缺失时退化为 `cwd:<cwd>`，再缺失则归到最近更新的活跃会话）找到对应 `SessionState` 并更新其 `state` / `cwd` / 时间戳，返回该 `sid`。单会话事件映射与原来一致：`permission_prompt`→红、`UserPromptSubmit`/`PreToolUse`/`PostToolUse`→黄、`Stop`→绿、`SessionStart`/`SessionEnd`→空闲。
4. `sendState()` 把 `appState.snapshot()` 通过 IPC `state-update` 推给悬浮窗，并同时把托盘图标换成对应颜色（`makeIcon` 内联生成 16×16 PNG，无外部资源）。快照里的灯色是**多会话聚合**结果：按 `PRIORITY` 取最严重态（红 > 黄 > 绿 > 空闲，idle 不会把灯降级），`mostUrgent()`（优先级降序、同级取 `lastUpdate` 最新）决定灯面项目名、hover 显示的会话与点击聚焦的终端。只有一个 CodeBuddy 会话时，表现与改造前完全一致。
5. **单实例保护**：`startServer` 若返回 `null`（端口已占用），主进程直接 `app.quit()`，避免多实例抢端口。

### 统计与持久化（`src/stats.js`）

- `findTranscript(cwd)`：把 cwd 用 `cwdToSlug` 编码成 CodeBuddy 项目目录名（`d-agent-workspace-...`），读取该目录下**最新**的 `.jsonl` 会话文件。
- `sumUsage(path)`：逐行解析 `.jsonl`，累加 `usage` 里的 `input_tokens` / `output_tokens` / `cache_creation_input_tokens` / `cache_read_input_tokens`（`extractUsage` 兼容 `o.usage` 与 `o.message.usage`）。
- `estimateCost(tokens, prices)`：按单价公式估算费用。
- 跨会话历史写入 `SIGNAL_DIR/stats.json`（会话列表 + 累计 totals），按 `(cwd, startTs)` 去重在 `SessionEnd` 时落盘（`main.js` 内）。
- 单价来自 `SIGNAL_DIR/settings.json` 的 `prices`（见 README），缺省用 `DEFAULT_PRICES`。`loadPrices` 在文件缺失/损坏时回退默认值，不抛错。

### IPC 约定

- 渲染 → 主进程（命令/查询）：`focus-terminal`、`minimize-light`、`show-hover-stats`/`hide-hover-stats`/`hover-enter`/`hover-leave`，以及 `ipcRenderer.invoke('get-stats')`。
- 主 → 渲染（推送）：`state-update`、`hover-stats`。新增能力时务必在 `preload.js` 暴露，并相应在 `main.js` 的 `ipcMain` 注册。

### 窗口拖拽/点击细节（改动 renderer/style.css 时易踩坑）

- 信号灯悬浮窗拖动由 CSS `-webkit-app-region: drag`（在 `style.css` 的 `.lights` 容器）处理；每个 `.light` 是 `no-drag`，所以**按住圆点周围区域**才能拖动，静止点击圆点才是“聚焦终端”。
- 点击有亮灯的灯 → `focusTerminal()`；悬停 500ms → 拉取 `getStats` 并显示侧边 hover 窗。相关逻辑在 `renderer/renderer.js`，注释里对上述行为有详细说明。

## 已知问题 / 坑

- **`tests/focus.test.js` 已过时**：它 require 了 `src/focus.js` 中不存在的 `parsePanes` / `findWindowIdForCwd`，并假设基于 `wezterm cli`（window_id/pane_id/cwd）的聚焦方式。当前 `focus.js` 已重写为 PowerShell + `user32` 实现，仅导出 `focusTerminal`。该测试文件会让 `npm test` 整体报失败——修复或删除它前，验证其它模块请用单文件运行（`node --test tests/<其它>.test.js`）。
- `main.js` 中保留了一些 `[DBG]` 开头的 `console.error` 调试日志（悬窗背景/阴影状态、hover 显隐、事件顺序），是排查窗口“第二层图层”和灯色错位用的，非错误，可保留或按需清理。
- 仅支持 Windows（PowerShell 聚焦、`wezterm cli` 假设、无边框窗口的 DWM 处理）。
- 设计背景与原始规格在 `docs/superpowers/specs/` 与 `docs/superpowers/plans/`，涉及重大改动时可作为依据参考。
