'use strict';

const { contextBridge, ipcRenderer, webUtils } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  getPathForFile: (file) => webUtils.getPathForFile(file),
  encodeBatch: (jobs, opts) => ipcRenderer.invoke('encode-batch', jobs, opts),
  onEncodeProgress: (cb) => {
    const channel = 'encode-progress';
    ipcRenderer.removeAllListeners(channel);
    ipcRenderer.on(channel, (_event, data) => {
      cb(data);
    });
  },
  pickOutputDir: () => ipcRenderer.invoke('pick-output-dir'),
});
