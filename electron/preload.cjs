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
  pauseEncode: (paused) => ipcRenderer.invoke('encode-pause', paused),
  stopEncode: () => ipcRenderer.invoke('encode-stop'),
  getAppVersion: () => ipcRenderer.invoke('get-app-version'),
  onUpdateAvailable: (cb) => {
    ipcRenderer.removeAllListeners('update-available');
    ipcRenderer.on('update-available', (_event, data) => cb(data));
  },
  onUpdateProgress: (cb) => {
    ipcRenderer.removeAllListeners('update-progress');
    ipcRenderer.on('update-progress', (_event, data) => cb(data));
  },
  installUpdate: () => ipcRenderer.invoke('update-install'),
});
