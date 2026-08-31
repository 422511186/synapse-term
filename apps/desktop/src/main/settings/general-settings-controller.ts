import {
  createGeneralSettingsStore,
  sanitizeGeneralSettings,
  type GeneralSettings,
} from './general-settings.js';

export interface GeneralSettingsControllerOptions {
  settingsStoreDirectory: string;
  apply: (settings: GeneralSettings) => Promise<void>;
}

export class GeneralSettingsController {
  readonly #store: ReturnType<typeof createGeneralSettingsStore>;
  readonly #apply: (settings: GeneralSettings) => Promise<void>;
  #settings: GeneralSettings = sanitizeGeneralSettings(undefined);

  constructor(options: GeneralSettingsControllerOptions) {
    this.#store = createGeneralSettingsStore(options.settingsStoreDirectory);
    this.#apply = options.apply;
  }

  async reload(): Promise<GeneralSettings> {
    this.#settings = await this.#store.load();
    await this.#apply(this.#settings);
    return structuredClone(this.#settings);
  }

  async getSettings(): Promise<GeneralSettings> {
    return structuredClone(this.#settings);
  }

  async updateSettings(patch: Partial<GeneralSettings>): Promise<GeneralSettings> {
    this.#settings = sanitizeGeneralSettings({ ...this.#settings, ...patch });
    await this.#store.save(this.#settings);
    await this.#apply(this.#settings);
    return structuredClone(this.#settings);
  }
}
