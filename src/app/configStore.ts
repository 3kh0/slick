// Settings and user stylesheet, synced with the main process. Plugins only
// ever see settings coerced against their schema.

import { type PluginSettings, resolveSettings, type SettingsSchema } from '../shared/settings.ts';
import type { SlickBridge } from './bridge.ts';

export type StoredConfig = {
  /** Global kill switch; false means Slick loads but does nothing. */
  enabled?: boolean;
  theme?: string;
  plugins?: Record<string, Record<string, unknown>>;
};

type SchemaEntry = { schema: SettingsSchema; defaultEnabled: boolean };

export class ConfigStore {
  private stored: StoredConfig = {};
  private storedIsValid = true;
  private settingsGeneration = 0;
  private schemas = new Map<string, SchemaEntry>();
  private resolved = new Map<string, PluginSettings>();
  private userCss = '';

  private configListeners = new Set<() => void>();
  private cssListeners = new Set<(css: string) => void>();

  private bridge: SlickBridge;

  constructor(bridge: SlickBridge) {
    this.bridge = bridge;
  }

  async init() {
    const [settings, userCss] = await Promise.all([
      this.bridge.readSettings().catch(() => '{}'),
      this.bridge.readUserCss().catch(() => ''),
    ]);
    const initial = this.parse(settings);
    this.stored = initial.config;
    this.storedIsValid = initial.valid;
    this.userCss = userCss;

    this.bridge.onSettingsChange((text) => {
      const next = this.parse(text);
      if (!next.valid) return;
      this.settingsGeneration++;
      this.acceptSettings(next.config, !this.bridge.compareAndSwapSettings);
    });

    this.bridge.onUserCssChange((css) => {
      this.userCss = css;
      for (const notify of this.cssListeners) {
        try {
          notify(css);
        } catch (error) {
          console.error('[slick] user css listener threw:', error);
        }
      }
    });
  }

  private acceptSettings(config: StoredConfig, notifyUnchanged = false) {
    const changed = !this.storedIsValid || JSON.stringify(config) !== JSON.stringify(this.stored);
    this.stored = config;
    this.storedIsValid = true;
    if (!changed && !notifyUnchanged) return;
    this.resolved.clear();
    for (const notify of this.configListeners) {
      try {
        notify();
      } catch (error) {
        console.error('[slick] config listener threw:', error);
      }
    }
  }

  private parse(text: string): { config: StoredConfig; valid: boolean } {
    try {
      const parsed = JSON.parse(text);
      return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
        ? { config: parsed, valid: true }
        : { config: {}, valid: false };
    } catch {
      // Don't persist defaults over a file that may still be recoverable.
      console.error('[slick] settings file is not valid JSON; changes will not be saved');
      return { config: {}, valid: false };
    }
  }

  registerSchema(id: string, schema: SettingsSchema, defaultEnabled: boolean) {
    this.schemas.set(id, { schema, defaultEnabled });
    this.resolved.delete(id);
  }

  get globallyEnabled(): boolean {
    return this.stored.enabled !== false;
  }

  get theme(): string {
    return typeof this.stored.theme === 'string' ? this.stored.theme : '';
  }

  getUserCss(): string {
    return this.userCss;
  }

  settingsFor(id: string): PluginSettings {
    const cached = this.resolved.get(id);
    if (cached) return cached;

    const entry = this.schemas.get(id);
    if (!entry) return { enabled: false };

    const settings = resolveSettings(entry.schema, entry.defaultEnabled, this.stored.plugins?.[id]);
    this.resolved.set(id, settings);
    return settings;
  }

  /** Its own switch and the global one. */
  isActive(id: string): boolean {
    return this.globallyEnabled && this.settingsFor(id).enabled === true;
  }

  onConfigChange(cb: () => void): () => void {
    this.configListeners.add(cb);
    return () => void this.configListeners.delete(cb);
  }

  onUserCssChange(cb: (css: string) => void): () => void {
    this.cssListeners.add(cb);
    return () => void this.cssListeners.delete(cb);
  }

  private updateTail: Promise<unknown> = Promise.resolve();

  async update(mutate: (config: StoredConfig) => void): Promise<boolean> {
    if (this.bridge.compareAndSwapSettings) {
      const run = this.updateTail
        .then(async () => {
          // Read on every attempt: multiple tabs and the options UI share storage.
          for (let attempt = 0; attempt < 8; attempt++) {
            const prior = await this.bridge.readSettings();
            const parsed = this.parse(prior);
            if (!parsed.valid) return false;
            mutate(parsed.config);
            const text = JSON.stringify(parsed.config, null, 2);
            if (await this.bridge.compareAndSwapSettings!(prior, text)) {
              // Notifications received while the refresh is in flight supersede
              // its snapshot. Never replace them with an older read response.
              const generation = this.settingsGeneration;
              try {
                const latest = this.parse(await this.bridge.readSettings());
                if (latest.valid && generation === this.settingsGeneration) this.acceptSettings(latest.config);
              } catch {
                /* The CAS already committed; a failed refresh is not a failed write. */
              }
              return true;
            }
          }
          return false;
        })
        .catch(() => false);
      this.updateTail = run;
      return run;
    }
    if (!this.storedIsValid) {
      console.error('[slick] refusing to overwrite an unreadable settings file');
      return false;
    }
    const next: StoredConfig = structuredClone(this.stored);
    mutate(next);
    this.stored = next;
    this.resolved.clear();
    return this.bridge.writeSettings(JSON.stringify(next, null, 2));
  }

  setPluginSetting(id: string, key: string, value: unknown) {
    return this.update((config) => {
      config.plugins ??= {};
      config.plugins[id] = { ...config.plugins[id], [key]: value };
    });
  }

  setPluginEnabled(id: string, enabled: boolean) {
    return this.setPluginSetting(id, 'enabled', enabled);
  }

  setTheme(theme: string) {
    return this.update((config) => {
      config.theme = theme;
    });
  }
}
