import { setStyle } from './api/css.ts';
import type { ConfigStore } from './configStore.ts';

const THEME_SELECTOR = ':root,html,body,.sk-client-theme--dark,.sk-client-theme--light';

export type ThemeJson = {
  name?: string;
  description?: string;
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
  const variables = declarations ? `${THEME_SELECTOR}{${declarations}}\n` : '';
  const extra = Array.isArray(theme.css) ? theme.css.join('\n') : (theme.css ?? '');
  return variables + extra;
}

export function installTheme(config: ConfigStore): () => void {
  const apply = () => {
    const selected = config.theme;
    const theme = selected && selected !== 'custom' ? __SLICK_THEMES__[selected] : undefined;
    setStyle(theme ? themeToCss(theme) : null, 'theme');
  };

  apply();
  return config.onConfigChange(apply);
}
