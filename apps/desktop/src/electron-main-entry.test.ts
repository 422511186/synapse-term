import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import { DESKTOP_IPC_REQUEST_CHANNELS } from './desktop-ipc-channels.js';

describe('Electron main entry', () => {
  it('does not block ESM module evaluation while waiting for Electron readiness', () => {
    const source = readFileSync(new URL('./electron-main.ts', import.meta.url), 'utf8');

    expect(source).not.toMatch(/^await app\.whenReady\(\);/m);
    expect(source).toContain('void startDesktopMain()');
  });

  it('disables hardware acceleration before Electron readiness', () => {
    const source = readFileSync(new URL('./electron-main.ts', import.meta.url), 'utf8');

    expect(source).toContain('app.disableHardwareAcceleration()');
    expect(source).toContain("app.commandLine.appendSwitch('in-process-gpu')");
  });

  it('builds renderer assets with paths relative to the packaged HTML file', () => {
    const source = readFileSync(new URL('../vite.renderer.config.ts', import.meta.url), 'utf8');

    expect(source).toContain("base: './'");
  });

  it('launches the packaged Core from its deployed dist directory', () => {
    const source = readFileSync(new URL('./electron-main.ts', import.meta.url), 'utf8');

    expect(source).toContain("join(process.resourcesPath, 'core', 'dist', 'core-main.mjs')");
  });

  it('terminates the packaged Core before the Electron app quits', () => {
    const source = readFileSync(new URL('./electron-main.ts', import.meta.url), 'utf8');

    expect(source).toContain("app.on('before-quit'");
    expect(source).toContain(".requestExit('terminate_all')");
    expect(source).toContain('event.preventDefault()');
  });

  it('registers resource requests and forwards resource snapshot events to the renderer', () => {
    const source = readFileSync(new URL('./electron-main.ts', import.meta.url), 'utf8');

    expect(DESKTOP_IPC_REQUEST_CHANNELS).toContain('resources:get');
    expect(DESKTOP_IPC_REQUEST_CHANNELS).toContain('resources:refresh');
    expect(source).toContain('for (const channel of DESKTOP_IPC_REQUEST_CHANNELS)');
    expect(source).toContain("broadcast('session:resources', event)");
    expect(source).toContain('requestTimeoutMs: 75_000');
  });

  it('forwards runtime Session changes to the preload event channel', () => {
    const source = readFileSync(new URL('./electron-main.ts', import.meta.url), 'utf8');

    expect(source).toContain("'session:changed'");
    expect(source).toContain("broadcast('session:changed', event)");
  });

  it('removes the native application menu', () => {
    const source = readFileSync(new URL('./electron-main.ts', import.meta.url), 'utf8');

    expect(source).toContain('Menu.setApplicationMenu(null)');
    expect(source).not.toContain('Menu.buildFromTemplate');
  });

  it('keeps the native menu bar hidden for every desktop window', () => {
    const source = readFileSync(new URL('./electron-main.ts', import.meta.url), 'utf8');

    expect(source).toContain('window.setMenuBarVisibility(false)');
  });

  it('marks the macOS traffic-light safe area without touching the DOM from preload', () => {
    const preload = readFileSync(new URL('./preload.ts', import.meta.url), 'utf8');
    const renderer = readFileSync(new URL('./renderer-main.tsx', import.meta.url), 'utf8');
    const styles = readFileSync(new URL('./styles.css', import.meta.url), 'utf8');

    expect(preload).not.toMatch(/\bdocument\b/);
    expect(preload).toContain('process.platform');
    expect(renderer).toContain('window.terminalAgent?.platform');
    expect(renderer).toContain('dataset.desktopPlatform = desktopPlatform');
    expect(styles).toContain("[data-desktop-platform='darwin'] .prototype-header");
    expect(styles).toContain('padding-left: 116px');
  });

  it('keeps the desktop Renderer test server off the reference prototype port', () => {
    const source = readFileSync(new URL('../vite.renderer.config.ts', import.meta.url), 'utf8');

    expect(source).toContain('port: 4173');
    expect(source).toContain('strictPort: true');
  });
});
