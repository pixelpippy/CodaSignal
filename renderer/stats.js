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
  const list = data.current || [];
  document.querySelector('#current .body').textContent = list.length
    ? list.map((c) => `项目: ${c.project} [${c.state}]\n时长: ${fmtMs(c.durationMs)}\ninput: ${fmtTokens(c.tokens.input)}\noutput: ${fmtTokens(c.tokens.output)}\ncache_read: ${fmtTokens(c.tokens.cacheRead)}\ncache_creation: ${fmtTokens(c.tokens.cacheCreation)}\n合计: ${fmtTokens(c.tokens.total)}\n费用(${data.prices.currency}): ${c.cost.toFixed(4)}`).join('\n\n')
    : '（暂无活跃会话 token 数据）';

  const t = data.totals || {};
  document.querySelector('#totals .body').textContent =
    `会话数: ${t.count || 0}\n总时长: ${fmtMs(t.durationMs)}\n总 token: ${fmtTokens(t.tokens)}\n总费用: ${(t.cost || 0).toFixed(4)} ${data.prices.currency}`;

  const hist = (data.sessions || []).slice(-20).reverse()
    .map((s) => `• ${s.project} | ${fmtMs(s.durationMs)} | ${fmtTokens((s.tokens && s.tokens.total) || 0)} tok | ${(s.cost || 0).toFixed(4)}`)
    .join('\n') || '（暂无历史）';
  document.querySelector('#history .body').textContent = hist;
}

refresh();
setInterval(refresh, 3000);
