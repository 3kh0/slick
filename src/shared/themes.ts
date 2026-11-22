import { record } from './objects.ts';

export const RENAMED_THEMES: Record<string, string> = { ultraviolet: 'catppuccin-mocha' };

const THEME_SELECTOR = ':root,html,body,.sk-client-theme--dark,.sk-client-theme--light';

export type CachedTheme = { css: string; mode?: 'dark' | 'light' };

export type ThemeJson = {
  name?: string;
  description?: string;
  mode?: 'dark' | 'light';
  palette?: Record<string, Record<string, unknown>>;
  sidebar?: Record<string, unknown>;
  vars?: Record<string, unknown>;
  css?: string | string[];
};

/** Convert the v1 theme format without changing its CSS ordering or precedence. */
export function themeToCss(theme: ThemeJson): string {
  const vars: Record<string, string> = {};

  for (const [ramp, shades] of Object.entries(theme.palette ?? {})) {
    for (const [shade, value] of Object.entries(shades)) {
      vars[`--dt_color-plt-${ramp}-${shade}`] = String(value);
    }
  }
  for (const [key, value] of Object.entries(theme.sidebar ?? {})) {
    vars[`--p-team_sidebar__${key}`] = String(value);
  }
  for (const [key, value] of Object.entries(theme.vars ?? {})) vars[key] = String(value);

  // Keys and values stay verbatim for v1 theme compatibility. They are not a
  // security boundary: the same theme format deliberately accepts arbitrary
  // CSS through `css`, and setStyle installs the result via textContent.
  const declarations = Object.entries(vars)
    .map(([key, value]) => `${key}:${value} !important`)
    .join(';');
  const varsBlock = declarations ? `${THEME_SELECTOR}{${declarations}}\n` : '';
  const extra = Array.isArray(theme.css) ? theme.css.join('\n') : (theme.css ?? '');
  return varsBlock + extra;
}

export function resolveThemeCss(stored: unknown, builtin: Record<string, ThemeJson>): CachedTheme | null {
  if (!record(stored) || typeof stored.theme !== 'string') return null;
  const selected = RENAMED_THEMES[stored.theme] ?? stored.theme;
  if (!selected || selected === 'custom') return null;
  const imported = importedThemes(stored.importedThemes);
  const theme = Object.hasOwn(imported, selected)
    ? imported[selected]
    : Object.hasOwn(builtin, selected)
      ? builtin[selected]
      : undefined;
  if (!theme) return null;
  const css = themeToCss(theme);
  if (!css) return null;
  return theme.mode ? { css, mode: theme.mode } : { css };
}

function variables(value: unknown): boolean {
  return record(value) && Object.values(value).every((entry) => typeof entry === 'string' || typeof entry === 'number');
}

/** Validate imported files before they reach the CSS converter. */
export function isThemeJson(value: unknown): value is ThemeJson {
  if (!record(value)) return false;
  if (value.name !== undefined && typeof value.name !== 'string') return false;
  if (value.description !== undefined && typeof value.description !== 'string') return false;
  if (value.mode !== undefined && value.mode !== 'dark' && value.mode !== 'light') return false;
  if (value.palette !== undefined && (!record(value.palette) || !Object.values(value.palette).every(variables)))
    return false;
  if (value.sidebar !== undefined && !variables(value.sidebar)) return false;
  if (value.vars !== undefined && !variables(value.vars)) return false;
  if (
    value.css !== undefined &&
    typeof value.css !== 'string' &&
    !(Array.isArray(value.css) && value.css.every((entry) => typeof entry === 'string'))
  )
    return false;
  return ['palette', 'sidebar', 'vars', 'css'].some((key) => value[key] !== undefined);
}

export function parseThemeJson(text: string, filename: string): ThemeJson {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    throw new Error('The theme file is not valid JSON.');
  }
  if (!isThemeJson(value)) throw new Error('Expected a Slick theme with palette, sidebar, vars, or css fields.');
  return { ...value, name: value.name?.trim() || filename.replace(/\.json$/i, '') || 'Imported theme' };
}

export function importedThemes(value: unknown): Record<string, ThemeJson> {
  if (!record(value)) return {};
  return Object.fromEntries(
    Object.entries(value).filter(
      (entry): entry is [string, ThemeJson] => entry[0].startsWith('imported:') && isThemeJson(entry[1]),
    ),
  );
}
