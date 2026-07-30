// renderer/hover.js
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
function render(data) {
  if (!data) return;
  const cur = data.current;
  document.getElementById('cur').textContent = cur ? `${fmtTokens(cur.tokens)} · ${fmtDur(cur.durationMs)}` : '无';
  document.getElementById('cost').textContent = fmtMoney(data.totals && data.totals.cost);
  document.getElementById('sessions').textContent = (data.sessions ? data.sessions.length : 0).toString();
  const t = data.totals && data.totals.tokens;
  document.getElementById('tokens').textContent = fmtTokens(t);
}

window.api.onHoverStats(render);

// 鼠标进入弹窗取消隐藏，离开则隐藏
document.body.addEventListener('mouseenter', () => window.api.hoverEnter());
document.body.addEventListener('mouseleave', () => window.api.hoverLeave());
