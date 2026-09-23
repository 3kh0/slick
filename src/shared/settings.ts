// Typed settings schema: drives plugin config, ctx.settings, Preferences and the
// extension options form. Coercion is central, so a hostile config can never
// reach a plugin as the wrong type.

export type SettingType = 'boolean' | 'number' | 'text' | 'select' | 'color' | 'file' | 'names' | 'schedule';

export type SelectOption = { value: string; label: string };

export type ScheduleRule = { days: number[]; start: string; end: string; status: string };

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
  | { type: 'names'; label: string; description?: string; default: Record<string, string> }
  | {
      type: 'schedule';
      label: string;
      description?: string;
      default: ScheduleRule[];
      statuses: SelectOption[];
    };

/** `enabled` is reserved: it is activation, not a setting, and is never declared. */
export type SettingsSchema = Record<string, Setting>;

export type SettingValue = boolean | number | string | Record<string, string> | ScheduleRule[];
export type PluginSettings = Record<string, SettingValue> & { enabled: boolean };

const MAX_TEXT = 4000;
const MAX_NAMES = 2000;
const MAX_RULES = 50;
const USER_ID = /^[UW][A-Z0-9]{6,}$/;
const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;

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

function coerceSchedule(value: unknown, setting: Extract<Setting, { type: 'schedule' }>): ScheduleRule[] {
  if (!Array.isArray(value)) return setting.default;

  const rules: ScheduleRule[] = [];
  for (const rule of value.slice(0, MAX_RULES)) {
    if (!rule || typeof rule !== 'object') continue;
    const { days, start, end, status } = rule as Record<string, unknown>;
    if (!Array.isArray(days) || typeof start !== 'string' || typeof end !== 'string') continue;
    if (!TIME.test(start) || !TIME.test(end)) continue;
    const valid = days.filter((day): day is number => Number.isInteger(day) && day >= 0 && day <= 6);
    rules.push({
      days: [...new Set(valid)].toSorted((a, b) => a - b),
      start,
      end,
      status: setting.statuses.some((option) => option.value === status)
        ? (status as string)
        : setting.statuses[0].value,
    });
  }
  return rules;
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

    case 'schedule':
      return coerceSchedule(value, setting);

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
    if (typeof a === 'object' && typeof b === 'object' && JSON.stringify(a) === JSON.stringify(b)) continue;
    changed.push(key);
  }
  return changed;
}
