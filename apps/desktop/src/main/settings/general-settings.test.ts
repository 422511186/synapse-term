import { describe, expect, it } from 'vitest';

import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  createGeneralSettingsStore,
  DEFAULT_GENERAL_SETTINGS,
  sanitizeGeneralSettings,
} from './general-settings.js';

describe('General settings', () => {
  it('defaults to hiding completion probe echo and accepts an explicit boolean', () => {
    expect(sanitizeGeneralSettings(undefined)).toEqual(DEFAULT_GENERAL_SETTINGS);
    expect(sanitizeGeneralSettings({ hideCompletionProbeEcho: false })).toEqual({
      hideCompletionProbeEcho: false,
    });
    expect(sanitizeGeneralSettings({ hideCompletionProbeEcho: 'false' })).toEqual(
      DEFAULT_GENERAL_SETTINGS,
    );
  });

  it('persists only the validated general setting', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'synapse-term-general-'));
    const store = createGeneralSettingsStore(directory);
    await store.save({ hideCompletionProbeEcho: false });

    expect(await store.load()).toEqual({ hideCompletionProbeEcho: false });
    expect(JSON.parse(await readFile(store.path, 'utf8'))).toEqual({
      hideCompletionProbeEcho: false,
    });
  });
});
