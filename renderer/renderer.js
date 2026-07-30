// renderer/renderer.js
const lights = Array.from(document.querySelectorAll('.light'));
const labelEl = document.getElementById('label');
const projectEl = document.getElementById('project');
const minBtn = document.getElementById('minBtn');
const lightsBox = document.querySelector('.lights');

window.api.onState((s) => {
  lights.forEach((el) => el.classList.toggle('active', el.dataset.state === s.state));
  labelEl.textContent = s.label || s.state;
  projectEl.textContent = s.project || '';
});

// 最小化按钮（不触发拖动）
minBtn.addEventListener('click', () => window.api.minimize());

// ---- 悬停红绿灯 -> 侧边统计弹窗 ----
// 灯光容器 .lights 是系统级拖动区域（drag），但每个 .light 是 no-drag，
// 指针事件会从 no-drag 子元素冒泡上来，所以用会冒泡的 mouseover/mouseout。
let hoverTimer = null;
function clearHover() {
  if (hoverTimer) { clearTimeout(hoverTimer); hoverTimer = null; }
}
lightsBox.addEventListener('mouseover', () => {
  clearHover();
  hoverTimer = setTimeout(() => {
    window.api.getStats().then((data) => window.api.showHoverStats(data));
  }, 500);
});
lightsBox.addEventListener('mouseout', (e) => {
  if (e.relatedTarget && lightsBox.contains(e.relatedTarget)) return; // 仅在真正离开灯光区时隐藏
  clearHover();
  window.api.hideHoverStats();
});

// ---- 点击亮着的红绿灯 -> 回到终端 ----
// 拖动完全由系统级 -webkit-app-region 处理（见 style.css）：在灯光区周围按下并移动 =
// 原生移动窗口，不会触发 click；只有静止点击（未拖动）才会触发 click，
// 因此“拖动”与“点击返回终端”互不干扰。
// 注意：直接按在某个红绿灯圆点上（no-drag）不会发起拖动，只能点击/悬停；要拖动请按住圆点周围区域。
lightsBox.addEventListener('mousedown', () => {
  clearHover();
  window.api.hideHoverStats();
});
lightsBox.addEventListener('click', () => {
  const anyActive = lights.some((el) => el.classList.contains('active'));
  if (anyActive) window.api.focusTerminal();
});
