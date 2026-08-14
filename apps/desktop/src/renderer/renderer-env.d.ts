import type { DesktopApi } from '../preload/preload-api.js';

declare global {
  interface Window {
    synapseTerm?: DesktopApi;
  }
}

export {};
