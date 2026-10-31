import { setStyle } from './api/css.ts';
import type { ConfigStore } from './configStore.ts';
import type { ThemeJson } from '../shared/themes.ts';
export type { ThemeJson } from '../shared/themes.ts';

const THEME_SELECTOR = ':root,html,body,.sk-client-theme--dark,.sk-client-theme--light';

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

const isDark = () => document.body?.classList.contains('sk-client-theme--dark') ?? false;

export function installTheme(config: ConfigStore): () => void {
  let theme: ThemeJson | undefined;
  let css = '';
  let installed: string | null = null;
  let observer: MutationObserver | null = null;

  const render = () => {
    const next = theme && (!theme.mode || isDark() === (theme.mode === 'dark')) ? css : null;
    if (next !== installed) setStyle((installed = next), 'theme');
  };

  const watch = () => {
    if (!theme?.mode) {
      observer?.disconnect();
      observer = null;
    } else if (!observer && document.body) {
      observer = new MutationObserver(render);
      observer.observe(document.body, { attributes: true, attributeFilter: ['class'] });
    }
  };

  const apply = () => {
    const selected = config.theme;
    theme =
      selected && selected !== 'custom' ? (config.importedThemes[selected] ?? __SLICK_THEMES__[selected]) : undefined;
    css = theme ? themeToCss(theme) : '';
    watch();
    render();
  };

  apply();
  if (!document.body) document.addEventListener('DOMContentLoaded', apply, { once: true });
  const stop = config.onConfigChange(apply);
  return () => {
    stop();
    observer?.disconnect();
    observer = null;
  };
}
