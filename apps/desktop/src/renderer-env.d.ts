import type { DesktopApi } from './preload-api.js';

declare global {
  interface Window {
    terminalAgent?: DesktopApi;
  }
}

export {};
