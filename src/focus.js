// src/focus.js
// 把终端窗口提到前台属于 Windows 行为：需要 user32 的 SetForegroundWindow。
// 后台进程直接调用会被 Windows 前台锁限制，因此这里从本应用（点击时处于前台）
// 通过 AttachThreadInput 附加到前台线程后再置前台。
const { execFileSync } = require('node:child_process');

// 候选终端进程名（不含 .exe）。按需增减。
// 注意：wezterm 的实际 GUI 进程是 wezterm-gui（wezterm 只是多路复用守护），必须单列。
const TERMINAL_NAMES = ['wezterm', 'wezterm-gui', 'WindowsTerminal', 'conhost', 'mintty'];

function buildScript() {
  const namesLiteral = '@(' + TERMINAL_NAMES.map((n) => `"${n}"`).join(',') + ')';
  return `
Add-Type @"
using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;
public class W32 {
  public delegate bool EnumProc(IntPtr h, int lp);
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h, out uint p);
  [DllImport("kernel32.dll")] public static extern uint GetCurrentThreadId();
  [DllImport("user32.dll")] public static extern bool AttachThreadInput(uint a, uint b, bool f);
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr h);
  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr h, int n);
  [DllImport("user32.dll")] public static extern bool IsIconic(IntPtr h);
  [DllImport("user32.dll")] public static extern bool EnumWindows(EnumProc cb, int lp);
}
"@
$names = ${namesLiteral}
$pids = @()
Get-Process | Where-Object { $names -contains $_.ProcessName } | ForEach-Object { $pids += $_.Id }
$found = New-Object System.Collections.Generic.List[IntPtr]
$cb = [W32+EnumProc]{ param($h, $lp); $procId = 0; [W32]::GetWindowThreadProcessId($h, [ref]$procId) | Out-Null; if ($pids -contains $procId) { $found.Add($h) }; return $true }
[W32]::EnumWindows($cb, 0) | Out-Null
$fg = [W32]::GetForegroundWindow()
$fgt = 0; [W32]::GetWindowThreadProcessId($fg, [ref]$fgt) | Out-Null
$mt = [W32]::GetCurrentThreadId()
[W32]::AttachThreadInput($mt, $fgt, $true) | Out-Null
foreach ($h in $found) {
  if ([W32]::IsIconic($h)) { [W32]::ShowWindow($h, 9) }
  [W32]::SetForegroundWindow($h) | Out-Null
}
[W32]::AttachThreadInput($mt, $fgt, $false) | Out-Null
`;
}

function focusTerminal(cwd) {
  try {
    execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', buildScript()], {
      windowsHide: true,
    });
    return true;
  } catch {
    return false;
  }
}

module.exports = { focusTerminal };
