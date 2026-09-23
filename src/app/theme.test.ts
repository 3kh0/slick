import assert from 'node:assert/strict';
import { test } from 'node:test';
import { themeToCss } from './theme.ts';

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
