import type { DesktopApi } from '../preload/preload-api.js';

declare global {
  interface Window {
    synapseTerm?: DesktopApi;
    __synapseMockMcpApproval?: (command?: string) => string;
    __synapseMockMcpTimeout?: () => boolean;
  }
}

export {};
