import { afterEach, describe, expect, it, vi } from 'vitest';

import { UpdateVerificationError, type UpdateAdapter } from './update-adapter.js';
import { UpdateController, type UpdateControllerOptions } from './update-controller.js';

function adapter(): UpdateAdapter {
  return {
    check: async () => ({ version: '0.6.0', releaseNotes: 'A verified release' }),
    download: async (_signal, progress) => {
      progress({ phase: 'verifying' });
    },
    prepare: async () => undefined,
    install: async () => undefined,
    dispose: async () => undefined,
  };
}

describe('application updates', () => {
  const controllers: UpdateController[] = [];
  afterEach(async () => {
    await Promise.all(controllers.splice(0).map((controller) => controller.dispose()));
    vi.useRealTimers();
  });

  function create(engine = adapter(), options: Partial<UpdateControllerOptions> = {}) {
    const controller = new UpdateController({
      currentVersion: '0.5.1',
      adapter: engine,
      automaticChecks: false,
      saveAutomaticChecks: async () => undefined,
      getSessionIds: () => [],
      shutdownForInstall: async () => undefined,
      ...options,
    });
    controllers.push(controller);
    return controller;
  }

  it('reports a failed check without claiming the running version is current', async () => {
    const engine = adapter();
    engine.check = async () => {
      throw new Error('GitHub unavailable');
    };
    const controller = create(engine);
    expect(await controller.check()).toMatchObject({
      phase: 'error',
      candidate: null,
      error: { stage: 'check' },
    });
  });

  it('merges concurrent checks and times out a stalled source', async () => {
    vi.useFakeTimers();
    let requests = 0;
    const engine = adapter();
    engine.check = () => {
      requests++;
      return new Promise(() => undefined);
    };
    const controller = create(engine);
    const first = controller.check();
    const second = controller.check();
    await vi.advanceTimersByTimeAsync(30_001);
    expect(await first).toMatchObject({ phase: 'error', error: { stage: 'check' } });
    expect(await second).toEqual(await first);
    expect(requests).toBe(1);
  });

  it.each(['0.5.1', '0.4.9', '0.6.0-beta.1', 'invalid'])(
    'ignores non-upgrade %s',
    async (version) => {
      const engine = adapter();
      engine.check = async () => ({ version, releaseNotes: '' });
      expect(await create(engine).check()).toMatchObject({ phase: 'idle', candidate: null });
    },
  );

  it('stops scheduled checks after the preference is disabled while manual checks still work', async () => {
    vi.useFakeTimers();
    const controller = create();
    await controller.setAutomaticChecks(true);
    await vi.advanceTimersByTimeAsync(15_001);
    expect(controller.getState().phase).toBe('available');
    await controller.setAutomaticChecks(false);
    const checkedAt = controller.getState().lastCheckedAt;
    await vi.advanceTimersByTimeAsync(6 * 60 * 60 * 1000);
    expect(controller.getState().lastCheckedAt).toBe(checkedAt);
    expect((await controller.check()).lastCheckedAt).not.toBe(checkedAt);
  });

  it('only installs a verified candidate after ending Sessions and consumes the confirmation', async () => {
    let sessions = ['session-1'];
    let installed = false;
    const engine = adapter();
    engine.install = async () => {
      expect(sessions).toEqual([]);
      installed = true;
    };
    const controller = create(engine, {
      getSessionIds: () => sessions,
      shutdownForInstall: async () => {
        sessions = [];
      },
    });
    const candidate = (await controller.check()).candidate!;
    expect(() => controller.getInstallImpact(candidate.id)).toThrow();
    expect((await controller.download(candidate.id)).phase).toBe('ready');
    expect(installed).toBe(false);
    const impact = controller.getInstallImpact(candidate.id);
    expect(impact.sessionCount).toBe(1);
    await controller.install(candidate.id, impact.confirmationId);
    expect(installed).toBe(true);
    await expect(controller.install(candidate.id, impact.confirmationId)).rejects.toThrow();
  });

  it('rejects Session changes both before and during installation preparation', async () => {
    let sessions = ['session-1'];
    const engine = adapter();
    const controller = create(engine, { getSessionIds: () => sessions });
    const candidate = (await controller.check()).candidate!;
    await controller.download(candidate.id);
    let impact = controller.getInstallImpact(candidate.id);
    sessions = ['session-2'];
    await expect(controller.install(candidate.id, impact.confirmationId)).rejects.toThrow();
    impact = controller.getInstallImpact(candidate.id);
    engine.prepare = async () => {
      sessions = ['session-2', 'session-3'];
    };
    expect(await controller.install(candidate.id, impact.confirmationId)).toMatchObject({
      phase: 'error',
      error: { stage: 'prepare' },
    });
    expect(sessions).toEqual(['session-2', 'session-3']);
  });

  it('keeps Sessions usable when verification or preparation fails', async () => {
    let running = true;
    const engine = adapter();
    engine.download = async () => {
      throw new UpdateVerificationError('bad signature');
    };
    const controller = create(engine, {
      shutdownForInstall: async () => {
        running = false;
      },
    });
    const candidate = (await controller.check()).candidate!;
    expect(await controller.download(candidate.id)).toMatchObject({
      phase: 'error',
      error: { stage: 'verify' },
    });
    expect(() => controller.getInstallImpact(candidate.id)).toThrow();
    engine.download = adapter().download;
    await controller.download(candidate.id);
    engine.prepare = async () => {
      throw new Error('package removed');
    };
    const impact = controller.getInstallImpact(candidate.id);
    expect(await controller.install(candidate.id, impact.confirmationId)).toMatchObject({
      phase: 'error',
      error: { stage: 'prepare' },
    });
    expect(running).toBe(true);
  });

  it('ignores late download progress and completion after cancellation', async () => {
    const engine = adapter();
    let complete = (): void => undefined;
    let lateProgress = (): void => undefined;
    engine.download = (_signal, progress) =>
      new Promise<void>((resolve) => {
        complete = resolve;
        lateProgress = () => progress({ phase: 'verifying' });
      });
    const controller = create(engine);
    const candidate = (await controller.check()).candidate!;
    const downloading = controller.download(candidate.id);
    await controller.cancel();
    lateProgress();
    complete();
    await downloading;
    expect(controller.getState()).toMatchObject({ phase: 'available', progress: null });
    expect(() => controller.getInstallImpact(candidate.id)).toThrow();
  });

  it('does not install on ordinary disposal even after a download', async () => {
    let installed = false;
    const engine = adapter();
    engine.install = async () => {
      installed = true;
    };
    const controller = create(engine);
    const candidate = (await controller.check()).candidate!;
    await controller.download(candidate.id);
    await controller.dispose();
    expect(installed).toBe(false);
  });

  it('rejects a confirmation that expires while preparation is pending', async () => {
    vi.useFakeTimers();
    let stopped = false;
    const engine = adapter();
    engine.prepare = async () => {
      await vi.advanceTimersByTimeAsync(60_001);
    };
    const controller = create(engine, {
      shutdownForInstall: async () => {
        stopped = true;
      },
    });
    const candidate = (await controller.check()).candidate!;
    await controller.download(candidate.id);
    const impact = controller.getInstallImpact(candidate.id);
    expect(await controller.install(candidate.id, impact.confirmationId)).toMatchObject({
      phase: 'error',
      error: { stage: 'prepare' },
    });
    expect(stopped).toBe(false);
  });
});
