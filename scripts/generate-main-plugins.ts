import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { mainHalvesModule } from './lib/plugin.ts';
import { DESKTOP } from './lib/paths.ts';

await writeFile(path.join(DESKTOP, 'mainPlugins.generated.ts'), mainHalvesModule());
