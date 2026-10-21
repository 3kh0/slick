import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { PLUGIN_NAMES, README, pluginNamesModule, pluginTable, withPluginTable } from './readme.ts';

test('generated plugin names match src/plugins', async () => {
  assert.equal(
    await readFile(PLUGIN_NAMES, 'utf8'),
    pluginNamesModule(),
    'src/plugins/names.generated.ts is stale; run `bun run readme`',
  );
});

test('README plugin table is current', async () => {
  const readme = await readFile(README, 'utf8');
  assert.equal(
    readme,
    withPluginTable(readme, await pluginTable()),
    'README.md plugin table is stale; run `bun run readme`',
  );
});
