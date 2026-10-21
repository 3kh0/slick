import { readFile, writeFile } from 'node:fs/promises';
import { PLUGIN_NAMES, README, pluginNamesModule, pluginTable, withPluginTable } from './lib/readme.ts';

await writeFile(PLUGIN_NAMES, pluginNamesModule());
await writeFile(README, withPluginTable(await readFile(README, 'utf8'), await pluginTable()));
