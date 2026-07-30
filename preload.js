// preload.js
const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('api', {
  onState: (cb) => ipcRenderer.on('state-update', (_e, s) => cb(s)),
  focusTerminal: () => ipcRenderer.send('focus-terminal'),
  minimize: () => ipcRenderer.send('minimize-light'),
  getStats: () => ipcRenderer.invoke('get-stats'),
});
