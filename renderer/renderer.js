// renderer/renderer.js
const lights = Array.from(document.querySelectorAll('.light'));
const labelEl = document.getElementById('label');
const projectEl = document.getElementById('project');
const minBtn = document.getElementById('minBtn');
const focusBtn = document.getElementById('focusBtn');
const statsPopup = document.getElementById('statsPopup');
const spCur = document.getElementById('spCur');
const spCost = document.getElementById('spCost');
const spSessions = document.getElementById('spSessions');
const spTokens = document.getElementById('spTokens');

window.api.onState((s) => {
  lights.forEach((el) => el.classList.toggle('active', el.dataset.state === s.state));
  labelEl.textContent = s.label || s.state;
  projectEl.textContent = s.project || '';
});

// 显式按钮：回到终端 / 最小化
focusBtn.addEventListener('click', () => window.api.focusTerminal());
minBtn.addEventListener('click', () => window.api.minimize());

// 鼠标悬停一段时间后显示统计信息
let hoverTimer = null;
function fmtMoney(n) {
  if (n == null) return '—';
  return '$' + (Math.round(n * 1000) / 1000).toFixed(3);
}
function fmtTokens(t) {
  if (!t) return '—';
  const total = t.total || (t.input + t.output) || 0;
  return total.toLocaleString('en-US');
}
function fmtDur(ms) {
  if (!ms) return '—';
  const s = Math.round(ms / 1000);
  const m = Math.floor(s / 60);
  return m > 0 ? `${m}m ${s % 60}s` : `${s}s`;
}
function showStats() {
  window.api.getStats().then((data) => {
    if (!data) return;
    const cur = data.current;
    spCur.textContent = cur ? `${fmtTokens(cur.tokens)} · ${fmtDur(cur.durationMs)}` : '无';
    spCost.textContent = fmtMoney(data.totals && data.totals.cost);
    spSessions.textContent = (data.sessions ? data.sessions.length : 0).toString();
    const t = data.totals && data.totals.tokens;
    spTokens.textContent = fmtTokens(t);
    statsPopup.classList.add('show');
  });
}
document.body.addEventListener('mouseenter', () => {
  hoverTimer = setTimeout(showStats, 500);
});
document.body.addEventListener('mouseleave', () => {
  if (hoverTimer) clearTimeout(hoverTimer);
  statsPopup.classList.remove('show');
});
