// renderer/renderer.js
const lights = Array.from(document.querySelectorAll('.light'));
const labelEl = document.getElementById('label');
const projectEl = document.getElementById('project');

window.api.onState((s) => {
  lights.forEach((el) => el.classList.toggle('active', el.dataset.state === s.state));
  labelEl.textContent = s.label || s.state;
  projectEl.textContent = s.project || '';
});

// 点击灯窗（除标题条外）聚焦终端
document.body.addEventListener('click', (e) => {
  if (e.target.classList.contains('titlebar')) return;
  window.api.focusTerminal();
});
