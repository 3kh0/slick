import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { PLUGINS } from '../plugins/names.generated.ts';
import { USERSCRIPT_EXCLUDED, USERSCRIPT_MAIN_PLUGINS, USERSCRIPT_PLUGINS } from '../userscript/plugins.ts';
import { BACKGROUND_PLUGINS, EXTENSION_PLUGINS, RENDERER_ONLY_ON_WEB, WEB_EXCLUDED } from './plugins.ts';

const HALVES = ['main.ts', 'browser.ts'];
const dir = (id: string) => path.join(import.meta.dirname, '../plugins', id);
const privileged = (id: string) => HALVES.some((file) => existsSync(path.join(dir(id), file)));
const has = (list: readonly string[], id: string) => list.includes(id);

test('opt-outs and opt-ins name real plugins', () => {
  for (const id of [...WEB_EXCLUDED, ...USERSCRIPT_EXCLUDED])
    assert.ok(has(PLUGINS, id), `${id} is excluded from web builds but isn't a plugin`);
  for (const id of RENDERER_ONLY_ON_WEB)
    assert.ok(privileged(id), `${id} is in RENDERER_ONLY_ON_WEB but has no main.ts or browser.ts`);
});

test('extension renderers never use api.fetch, which the extension bridge denies', () => {
  for (const id of EXTENSION_PLUGINS) {
    const files = readdirSync(dir(id), { recursive: true, encoding: 'utf8' }).filter(
      (file) => /\.tsx?$/.test(file) && !/\.test\.tsx?$/.test(file) && !HALVES.includes(file),
    );
    for (const file of files)
      assert.doesNotMatch(
        readFileSync(path.join(dir(id), file), 'utf8'),
        /\bapi\.fetch\b/,
        `${id}/${file} uses api.fetch; add ${id} to WEB_EXCLUDED in src/extension/plugins.ts`,
      );
  }
});

for (const [target, plugins, hosted, list] of [
  ['extension', EXTENSION_PLUGINS, BACKGROUND_PLUGINS, 'BACKGROUND_PLUGINS'],
  ['userscript', USERSCRIPT_PLUGINS, USERSCRIPT_MAIN_PLUGINS, 'USERSCRIPT_MAIN_PLUGINS'],
] as const) {
  test(`${target} runs or deliberately skips every privileged half`, () => {
    for (const id of plugins)
      assert.ok(
        !privileged(id) || has(hosted, id) || has(RENDERER_ONLY_ON_WEB, id),
        `${id} has a main.ts/browser.ts the ${target} never runs: host it in ${list}, list it in RENDERER_ONLY_ON_WEB if its renderer copes without it, or add it to WEB_EXCLUDED`,
      );
    for (const id of hosted) assert.ok(privileged(id), `${id} is in ${list} but has no main.ts or browser.ts`);
  });
}
