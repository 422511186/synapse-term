import { contextBridge, ipcRenderer } from 'electron';

import { createDesktopApi, type RendererIpc } from './preload-api.js';

const ipc: RendererIpc = {
  invoke: (channel, ...argumentsValue) => ipcRenderer.invoke(channel, ...argumentsValue),
  on: (channel, listener) => {
    const handler = (_event: Electron.IpcRendererEvent, payload: unknown): void => {
      listener(payload);
    };
    ipcRenderer.on(channel, handler);
    return () => ipcRenderer.removeListener(channel, handler);
  },
};

contextBridge.exposeInMainWorld('synapseTerm', createDesktopApi(ipc, process.platform));
