import { setStyle } from './api/css.ts';
import type { ConfigStore } from './configStore.ts';
import { themeToCss, type ThemeJson } from '../shared/themes.ts';
export { themeToCss, type ThemeJson };

let cachedThemes: Record<string, ThemeJson> | null = null;
export function builtinThemes(): Record<string, ThemeJson> {
  return (cachedThemes ??= typeof __SLICK_THEMES__ === 'string' ? JSON.parse(__SLICK_THEMES__) : __SLICK_THEMES__);
}

const isDark = () => document.body?.classList.contains('sk-client-theme--dark') ?? false;

export function installTheme(config: ConfigStore): () => void {
  let theme: ThemeJson | undefined;
  let css = '';
  let installed: string | null | undefined;
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
    const builtins = builtinThemes();
    theme =
      selected && selected !== 'custom'
        ? (config.importedThemes[selected] ?? (Object.hasOwn(builtins, selected) ? builtins[selected] : undefined))
        : undefined;
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
