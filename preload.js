// preload.js
const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('api', {
  onState: (cb) => ipcRenderer.on('state-update', (_e, s) => cb(s)),
  focusTerminal: () => ipcRenderer.send('focus-terminal'),
  minimize: () => ipcRenderer.send('minimize-light'),
  // 侧边统计弹窗
  showHoverStats: (data) => ipcRenderer.send('show-hover-stats', data),
  hideHoverStats: () => ipcRenderer.send('hide-hover-stats'),
  hoverEnter: () => ipcRenderer.send('hover-enter'),
  hoverLeave: () => ipcRenderer.send('hover-leave'),
  // 弹窗自身渲染
  onHoverStats: (cb) => ipcRenderer.on('hover-stats', (_e, data) => cb(data)),
  getStats: () => ipcRenderer.invoke('get-stats'),
});
