# CodaSignal

Windows 桌面应用：用红 / 黄 / 绿信号灯实时反映 CodeBuddy CLI 会话状态，点击可聚焦 WezTerm 终端，并提供统计面板展示 token 用量、会话时长与可配置费用估算（含跨会话历史）。

## 特性

- 🚦 悬浮信号灯：红灯=等待审批，黄灯=思考中/执行中，绿灯=已完成（空闲=灰）。
  - 黄灯在**你发送消息的瞬间**即亮起（CodeBuddy 触发 `UserPromptSubmit`），无需等模型先决定调用工具，避免“思考起点”延迟一步。
- 🖱️ 点击信号灯或托盘，自动把焦点切回运行 CodeBuddy 的终端窗口（支持 WezTerm / Windows Terminal / mintty / conhost 等）。
- 📊 统计面板：本次会话 / 累计 / 历史会话的 token 用量、时长、估算费用。
- 🪟 悬停信号灯可弹出当前会话的 token / 费用速览。
- 🔌 零依赖 hook：仅用 Git Bash 自带的 `curl` 转发 CodeBuddy 通过 stdin 传入的会话 JSON（含 `cwd` / `transcript_path` / `session_id`）。
- 📦 开源（MIT），可打包为 Windows 安装包。

## 架构

Electron 主进程常驻，运行本地 HTTP 服务（`127.0.0.1:18765`）接收 CodeBuddy hook 发来的 `curl` 事件；主进程维护状态并驱动置顶半透明悬浮窗（三盏灯 + 托盘）与统计面板窗口。Token 数据由主进程直接读取 CodeBuddy 通过 hook 传入的 `transcript_path` 对应的 `.jsonl` 会话记录并累加 `usage`（无需靠目录 slug 猜测，避开大小写/斜杠不一致）。

## 安装

```bash
npm install
```

> 注意：Electron 二进制在部分网络环境下下载可能受限，需能访问 Electron 发布源。

## 开发运行

```bash
npm start
```

启动后任务栏托盘出现 CodaSignal 图标，桌面右上角出现信号灯悬浮窗。

## 配置 Hook

详见 [hooks/setup-hooks.md](hooks/setup-hooks.md)。把其中的 `hooks` 片段加入你的 `~/.codebuddy/settings.json` 即可。

## 统计与费用配置

历史与配置持久化在 `~/.codasignal/`：
- `~/.codasignal/stats.json`：跨会话统计（自动维护）。
- `~/.codasignal/settings.json`：可配置单价，例如：

```json
{
  "prices": {
    "input_per_1m": 3.0,
    "output_per_1m": 15.0,
    "cache_creation_per_1m": 3.75,
    "cache_read_per_1m": 0.3,
    "currency": "USD"
  }
}
```

未配置时采用内置默认单价。

## 端口

默认 `18765`，可用环境变量 `CODASIGNAL_PORT` 覆盖（同时需同步修改 hook 里的端口）。若端口被占用，CodaSignal 会自动退出以避免多实例。

## 打包

```bash
npm run dist
```

在 `dist/` 生成 `CodaSignal Setup <ver>.exe` 安装包（NSIS），例如 `dist/CodaSignal Setup 0.1.0.exe`。

## 开源协议

[MIT](LICENSE)
