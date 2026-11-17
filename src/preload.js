'use strict';

const { contextBridge, ipcRenderer, webUtils } = require('electron');

contextBridge.exposeInMainWorld('converter', {
  openInputFiles: () => ipcRenderer.invoke('dialog:open-input'),
  chooseOutputFile: (suggestedPath) => ipcRenderer.invoke('dialog:save-output', suggestedPath),
  getFileInfo: (inputPath) => ipcRenderer.invoke('file:info', inputPath),
  suggestOutputPath: (inputPath) => ipcRenderer.invoke('path:suggest-output', inputPath),
  getDroppedFilePath: (file) => webUtils.getPathForFile(file),
  startConversion: (request) => ipcRenderer.invoke('conversion:start', request),
  cancelConversion: () => ipcRenderer.invoke('conversion:cancel'),
  openOutputFolder: (filePath) => ipcRenderer.invoke('path:open-folder', filePath),
  onProgress: (callback) => {
    const listener = (_event, payload) => callback(payload);
    ipcRenderer.on('conversion:progress', listener);
    return () => ipcRenderer.removeListener('conversion:progress', listener);
  }
});
