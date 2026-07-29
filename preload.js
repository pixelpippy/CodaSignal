// preload.js
const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('api', {
  onState: (cb) => ipcRenderer.on('state-update', (_e, s) => cb(s)),
  focusTerminal: () => ipcRenderer.send('focus-terminal'),
  getStats: () => ipcRenderer.invoke('get-stats'),
});
