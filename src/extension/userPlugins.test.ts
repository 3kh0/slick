import assert from 'node:assert/strict';
import { test } from 'node:test';
import { installedPlugins, parsePluginFile, syncUserScripts, userScripts } from './userPlugins.ts';

const file = (meta: string) => `// slick-plugin ${meta}\n(globalThis.__slickPlugins ??= []).push(() => {});\n`;

test('plugin files are recognised by their build header', () => {
  const code = file('{"id":"Mine","name":"Mine","description":"Does things"}');
  assert.deepEqual(parsePluginFile(code), { id: 'Mine', name: 'Mine', description: 'Does things', code });
  for (const bad of ['module.exports = {}', file('{"id":"../x"}'), file('not json'), file('{"name":"No id"}')])
    assert.throws(() => parsePluginFile(bad), /not a Slick plugin/);
});

test('stored plugins are re-validated and their ids must match their keys', () => {
  const ok = { id: 'Mine', name: 'Mine', description: '', code: 'x' };
  assert.deepEqual(installedPlugins({ Mine: ok, Other: ok, Bad: { id: 'Bad' }, '../x': { ...ok, id: '../x' } }), {
    Mine: ok,
  });
  assert.deepEqual(installedPlugins('nope'), {});
});

test('sync replaces every registered script with one MAIN-world script per plugin', async () => {
  const calls: unknown[] = [];
  const api = {
    getScripts: async () => [],
    unregister: async (filter?: unknown) => void calls.push(['unregister', filter]),
    register: async (scripts: unknown) => void calls.push(['register', scripts]),
  };
  assert.equal(userScripts({}), null);
  assert.equal(
    userScripts({
      userScripts: {
        ...api,
        getScripts: () => {
          throw new Error('Allow User Scripts is off');
        },
      },
    }),
    null,
  );
  await syncUserScripts(userScripts({ userScripts: api })!, {
    Mine: { id: 'Mine', name: 'Mine', description: '', code: 'code' },
  });
  await syncUserScripts(api, {});
  assert.deepEqual(calls, [
    ['unregister', undefined],
    [
      'register',
      [
        {
          id: 'plugin-Mine',
          matches: ['https://app.slack.com/client', 'https://app.slack.com/client/*'],
          js: [{ code: 'code' }],
          runAt: 'document_start',
          world: 'MAIN',
        },
      ],
    ],
    ['unregister', undefined],
  ]);
});
