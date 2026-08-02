import type { DesktopApi } from '../preload/preload-api.js';

declare global {
  interface Window {
    terminalAgent?: DesktopApi;
  }
}

export {};
