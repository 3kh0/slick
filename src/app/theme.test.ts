import assert from 'node:assert/strict';
import { test } from 'node:test';
import { installTheme, themeToCss } from './theme.ts';
import type { ConfigStore } from './configStore.ts';
import { importedThemes, parseThemeJson } from '../shared/themes.ts';
import { readFileSync } from 'node:fs';

const selector = ':root,html,body,.sk-client-theme--dark,.sk-client-theme--light';

test('themeToCss converts palette and sidebar variables and lets vars win', () => {
  const css = themeToCss({
    palette: { aubergine: { 0: '1,2,3', 10: '4,5,6' } },
    sidebar: { 'nav-bg': '#111' },
    vars: {
      '--dt_color-plt-aubergine-0': '#override',
      '--custom': 42,
    },
  });

  assert.equal(
    css,
    `${selector}{--dt_color-plt-aubergine-0:#override !important;--dt_color-plt-aubergine-10:4,5,6 !important;--p-team_sidebar__nav-bg:#111 !important;--custom:42 !important}\n`,
  );
});

test('themeToCss appends CSS arrays verbatim with newlines', () => {
  assert.equal(themeToCss({ css: ['body{color:red}', '.foo{display:none}'] }), 'body{color:red}\n.foo{display:none}');
});

test('themeToCss accepts a CSS string and empty themes', () => {
  assert.equal(themeToCss({ css: 'body { color: red; }' }), 'body { color: red; }');
  assert.equal(themeToCss({}), '');
});

test('themeToCss preserves hostile variable keys because themes already accept arbitrary CSS', () => {
  assert.equal(themeToCss({ vars: { '--accent;color': 'red' } }), `${selector}{--accent;color:red !important}\n`);
});

test('themeToCss preserves hostile variable values because themes already accept arbitrary CSS', () => {
  assert.equal(
    themeToCss({ vars: { '--accent': 'red;}body{display:none}/*' } }),
    `${selector}{--accent:red;}body{display:none}/* !important}\n`,
  );
});

test('imported built-in JSON produces identical CSS and preserves its name', () => {
  const text = readFileSync(new URL('../../themes/catppuccin-mocha.json', import.meta.url), 'utf8');
  const theme = parseThemeJson(text, 'theme.json');
  assert.equal(theme.name, 'Catppuccin Mocha');
  assert.equal(themeToCss(theme), themeToCss(JSON.parse(text)));
});

test('theme imports reject malformed field shapes before CSS conversion', () => {
  for (const value of [
    null,
    [],
    {},
    { name: 'Metadata only' },
    { palette: { red: null } },
    { palette: { red: [] } },
    { sidebar: 'bad' },
    { vars: { '--x': {} } },
    { css: [42] },
    { css: null },
    { css: {}, name: 42 },
    { vars: {}, description: false },
  ]) {
    assert.throws(() => parseThemeJson(JSON.stringify(value), 'invalid.json'), /Expected a Slick theme/);
  }
  assert.throws(() => parseThemeJson('body { color: red; }', 'style.css'), /not valid JSON/);
});

test('theme imports support filename fallback and ignore invalid saved entries', () => {
  const theme = parseThemeJson('{"name":" ","vars":{"--accent":"#abc"}}', 'catppuccin-latte.json');
  assert.equal(theme.name, 'catppuccin-latte');
  assert.deepEqual(importedThemes({ 'imported:one': theme, 'imported:bad': { palette: null }, amoled: theme }), {
    'imported:one': theme,
  });
  assert.deepEqual(importedThemes(null), {});
});

test('selected imported themes install, switch, and remove their stylesheet', () => {
  const oldDocument = Object.getOwnPropertyDescriptor(globalThis, 'document');
  const oldThemes = Object.getOwnPropertyDescriptor(globalThis, '__SLICK_THEMES__');
  const styles = new Set<{ textContent: string }>();
  Object.defineProperty(globalThis, 'document', {
    configurable: true,
    value: {
      createElement: () => {
        const style = { dataset: {}, textContent: '', remove: () => styles.delete(style) };
        return style;
      },
      head: { appendChild: (style: { textContent: string }) => styles.add(style) },
    },
  });
  Object.defineProperty(globalThis, '__SLICK_THEMES__', {
    configurable: true,
    value: { builtin: { css: 'body{color:blue}' } },
  });
  let apply!: () => void;
  const config = {
    theme: 'imported:latte',
    importedThemes: { 'imported:latte': { vars: { '--accent': '#8839ef' } } },
    onConfigChange: (listener: () => void) => {
      apply = listener;
      return () => {};
    },
  };
  try {
    const stop = installTheme(config as unknown as ConfigStore);
    assert.equal([...styles][0].textContent, themeToCss(config.importedThemes['imported:latte']));
    config.theme = 'builtin';
    apply();
    assert.equal(styles.size, 1);
    assert.equal([...styles][0].textContent, 'body{color:blue}');
    config.theme = '';
    apply();
    assert.equal(styles.size, 0);
    stop();
  } finally {
    config.theme = '';
    apply?.();
    if (oldDocument) Object.defineProperty(globalThis, 'document', oldDocument);
    else Reflect.deleteProperty(globalThis, 'document');
    if (oldThemes) Object.defineProperty(globalThis, '__SLICK_THEMES__', oldThemes);
    else Reflect.deleteProperty(globalThis, '__SLICK_THEMES__');
  }
});
