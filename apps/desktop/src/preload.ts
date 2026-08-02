import { contextBridge, ipcRenderer } from 'electron';

import { createDesktopApi } from './preload-api.js';

const api = createDesktopApi(
  {
    invoke: (channel, ...argumentsValue) => ipcRenderer.invoke(channel, ...argumentsValue),
    on: (channel, listener) => {
      const handler = (_event: Electron.IpcRendererEvent, payload: unknown) => listener(payload);
      ipcRenderer.on(channel, handler);
      return () => ipcRenderer.removeListener(channel, handler);
    },
  },
  process.platform,
);

contextBridge.exposeInMainWorld('terminalAgent', api);
