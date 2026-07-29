// renderer/stats.js
function fmtMs(ms) {
  if (!ms) return '0s';
  const s = Math.round(ms / 1000);
  const m = Math.floor(s / 60);
  return m > 0 ? `${m}m${s % 60}s` : `${s}s`;
}
function fmtTokens(n) { return (n || 0).toLocaleString(); }

async function refresh() {
  const data = await window.api.getStats();
  const cur = data.current;
  document.querySelector('#current .body').textContent = cur
    ? `项目: ${cur.project}\n时长: ${fmtMs(cur.durationMs)}\ninput: ${fmtTokens(cur.tokens.input)}\noutput: ${fmtTokens(cur.tokens.output)}\ncache_read: ${fmtTokens(cur.tokens.cacheRead)}\ncache_creation: ${fmtTokens(cur.tokens.cacheCreation)}\n合计: ${fmtTokens(cur.tokens.total)}\n费用(${data.prices.currency}): ${cur.cost.toFixed(4)}`
    : '（暂无本次会话 token 数据）';

  const t = data.totals || {};
  document.querySelector('#totals .body').textContent =
    `会话数: ${t.count || 0}\n总时长: ${fmtMs(t.durationMs)}\n总 token: ${fmtTokens(t.tokens)}\n总费用: ${(t.cost || 0).toFixed(4)} ${data.prices.currency}`;

  const list = (data.sessions || []).slice(-20).reverse()
    .map((s) => `• ${s.project} | ${fmtMs(s.durationMs)} | ${fmtTokens(s.tokens.total)} tok | ${s.cost.toFixed(4)}`)
    .join('\n') || '（暂无历史）';
  document.querySelector('#history .body').textContent = list;
}

refresh();
setInterval(refresh, 3000);
