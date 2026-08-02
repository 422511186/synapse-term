export interface DesktopBrowserWindowOptions {
  width: number;
  height: number;
  minWidth: number;
  minHeight: number;
  show: boolean;
  autoHideMenuBar: boolean;
  backgroundColor: string;
  titleBarStyle: 'hiddenInset';
  trafficLightPosition: { x: number; y: number };
  webPreferences: {
    preload: string;
    sandbox: true;
    contextIsolation: true;
    nodeIntegration: false;
  };
}

export interface RetainableDesktopWindow {
  once(event: 'closed', listener: () => void): unknown;
}

export class DesktopWindowRegistry<
  Window extends RetainableDesktopWindow = RetainableDesktopWindow,
> {
  readonly #windows = new Set<Window>();

  get size(): number {
    return this.#windows.size;
  }

  retain(window: Window): Window {
    this.#windows.add(window);
    window.once('closed', () => this.#windows.delete(window));
    return window;
  }
}

export function createBrowserWindowOptions(preloadPath: string): DesktopBrowserWindowOptions {
  return {
    width: 1440,
    height: 900,
    minWidth: 360,
    minHeight: 600,
    show: false,
    autoHideMenuBar: true,
    // Match the Renderer Header so native macOS controls live on the same surface.
    backgroundColor: '#09090b',
    titleBarStyle: 'hiddenInset',
    // Center the 12px traffic lights in the 56px Header instead of leaving them
    // visually detached at the top edge.
    trafficLightPosition: { x: 16, y: 20 },
    webPreferences: {
      preload: preloadPath,
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
    },
  };
}
