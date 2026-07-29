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
