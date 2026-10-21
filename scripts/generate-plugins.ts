import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { PLUGIN_NAMES_FILE, mainHalvesModule, pluginNamesModule } from './lib/plugin.ts';
import { DESKTOP } from './lib/paths.ts';

await writeFile(path.join(DESKTOP, 'mainPlugins.generated.ts'), mainHalvesModule());
await writeFile(PLUGIN_NAMES_FILE, pluginNamesModule());
