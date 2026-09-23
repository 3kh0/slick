// Typed settings schema: drives plugin config, ctx.settings, Preferences and the
// extension options form. Coercion is central, so a hostile config can never
// reach a plugin as the wrong type.

export type SettingType = 'boolean' | 'number' | 'text' | 'select' | 'color' | 'file' | 'names';

export type SelectOption = { value: string; label: string };

export type Setting =
  | { type: 'boolean'; label: string; description?: string; default: boolean; restartRequired?: boolean }
  | {
      type: 'number';
      label: string;
      description?: string;
      default: number;
      min?: number;
      max?: number;
      restartRequired?: boolean;
    }
  | {
      type: 'text' | 'color' | 'file';
      label: string;
      description?: string;
      default: string;
      maxLength?: number;
      /** For `file`: the extensions the picker offers, as an input accept list. */
      accept?: string;
      restartRequired?: boolean;
    }
  | {
      type: 'select';
      label: string;
      description?: string;
      default: string;
      options: SelectOption[];
      restartRequired?: boolean;
    }
  | { type: 'names'; label: string; description?: string; default: Record<string, string> };

/** `enabled` is reserved: it is activation, not a setting, and is never declared. */
export type SettingsSchema = Record<string, Setting>;

export type SettingValue = boolean | number | string | Record<string, string>;
export type PluginSettings = Record<string, SettingValue> & { enabled: boolean };

const MAX_TEXT = 4000;
const MAX_NAMES = 2000;
const USER_ID = /^[UW][A-Z0-9]{6,}$/;

function coerceNames(value: unknown, fallback: Record<string, string>): Record<string, string> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return fallback;

  const names: Record<string, string> = {};
  let count = 0;
  for (const [id, name] of Object.entries(value as Record<string, unknown>)) {
    if (count >= MAX_NAMES) break;
    if (!USER_ID.test(id)) continue;
    if (typeof name !== 'string' || !name || name.length > 100) continue;
    names[id] = name;
    count++;
  }
  return names;
}

export function coerceSetting(setting: Setting, value: unknown): SettingValue {
  if (value === undefined) return setting.default;

  switch (setting.type) {
    case 'boolean':
      return value === true;

    case 'number': {
      const number = Number(value);
      if (!Number.isFinite(number)) return setting.default;
      return Math.min(Math.max(number, setting.min ?? -Infinity), setting.max ?? Infinity);
    }

    case 'select':
      return setting.options.some((option) => option.value === value) ? (value as string) : setting.default;

    case 'color':
      return typeof value === 'string' && /^#[0-9a-fA-F]{3,8}$/.test(value) ? value : setting.default;

    case 'names':
      return coerceNames(value, setting.default);

    default:
      return typeof value === 'string' ? value.slice(0, setting.maxLength ?? MAX_TEXT) : setting.default;
  }
}

/** Unknown keys are dropped; a missing plugin falls back to `defaultEnabled`. */
export function resolveSettings(
  schema: SettingsSchema,
  defaultEnabled: boolean,
  stored: Record<string, unknown> | undefined,
): PluginSettings {
  const resolved: Record<string, SettingValue> = {};
  for (const [name, setting] of Object.entries(schema)) {
    resolved[name] = stored && Object.hasOwn(stored, name) ? coerceSetting(setting, stored[name]) : setting.default;
  }
  const enabled = stored && typeof stored.enabled === 'boolean' ? stored.enabled : defaultEnabled;
  return { ...resolved, enabled };
}

export function changedKeys(before: PluginSettings, after: PluginSettings): string[] {
  const keys = new Set([...Object.keys(before), ...Object.keys(after)]);
  const changed: string[] = [];
  for (const key of keys) {
    const a = before[key];
    const b = after[key];
    if (a === b) continue;
    // `names` maps are the only structured value.
    if (typeof a === 'object' && typeof b === 'object' && JSON.stringify(a) === JSON.stringify(b)) continue;
    changed.push(key);
  }
  return changed;
}
