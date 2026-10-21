// Dev runner: build the loader, launch it with the project's Electron, then
// rebuild on save. A file only one renderer plugin uses hot-swaps that plugin;
// other page code reloads Slack; main/preload code restarts Electron.
// `node scripts/desktop.ts [--safe-mode]`

import { type ChildProcess, spawn } from 'node:child_process';
import { existsSync, watch } from 'node:fs';
import { rename, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import type { Metafile } from 'esbuild';
import { buildDesktop, stageApp } from './build/desktop.ts';
import { buildHotPlugin, HOT_DIR } from './build/hot.ts';
import { DIST_DESKTOP, ROOT, SRC, THEMES } from './lib/paths.ts';
import { repoPath } from './lib/plugin.ts';

// Same Electron that gets packaged; the package's main export is its binary path.
const electron = String(createRequire(import.meta.url)('electron'));
if (!existsSync(electron)) {
  console.error(`No Electron at ${electron}. Run: bun install`);
  process.exit(1);
}

let appInputs: Metafile['inputs'] = {};
let mainInputs = new Set<string>();

async function buildAll() {
  const { app, main } = await buildDesktop({ debug: true, hot: true });
  appInputs = app.inputs;
  mainInputs = new Set(main.flatMap((m) => Object.keys(m.inputs)));
}

const rebuildApp = async () => void (appInputs = (await stageApp({ debug: true, hot: true })).inputs);

await buildAll();

// Separate profile so dev can't mangle the real install's session. Point
// SLICK_HANDOFF_PROFILE at "~/Library/Application Support/Slick" to reuse it.
const profile = process.env.SLICK_HANDOFF_PROFILE || path.join(ROOT, 'work', 'dev-profile');
console.log(`[dev] profile: ${profile}`);

let child: ChildProcess;
let restarting = false;
function launch() {
  child = spawn(electron, [DIST_DESKTOP, ...process.argv.slice(2)], {
    stdio: 'inherit',
    env: { ...process.env, ELECTRON_ENABLE_LOGGING: '1', SLICK_HANDOFF_PROFILE: profile, SLICK_HOT: '1' },
  });
  child.on('exit', (code) => {
    if (!restarting) process.exit(code ?? 0);
    restarting = false;
    launch();
  });
}

function restart() {
  if (restarting) return;
  restarting = true;
  console.log('[dev] restarting Electron');
  const c = child;
  c.kill();
  setTimeout(() => c.kill('SIGKILL'), 5_000);
}

launch();

let seq = Date.now();
async function notify(update: { reload: true } | { plugins: string[] }) {
  const file = path.join(HOT_DIR, 'update.json');
  await writeFile(`${file}.tmp`, JSON.stringify({ seq: ++seq, ...update }));
  await rename(`${file}.tmp`, file);
}

const GENERATED = 'src/desktop/mainPlugins.generated.ts';
const PLUGIN_FILE = /^src\/plugins\/([^/]+)\//;

const importedOutside = (file: string, dir: string) =>
  Object.entries(appInputs).some(
    ([from, i]) =>
      !from.startsWith(dir) && !from.startsWith('slick-plugins:') && i.imports.some((x) => x.path === file),
  );

function classify(file: string): 'restart' | 'reload' | { plugin: string } | null {
  if (file === GENERATED) return null;
  if (mainInputs.has(file)) return 'restart';
  const plugin = PLUGIN_FILE.exec(file)?.[1];
  if (appInputs[file]) return plugin && !importedOutside(file, `src/plugins/${plugin}/`) ? { plugin } : 'reload';
  if (file.startsWith('themes/')) return 'reload';
  return plugin && /\/(index\.tsx?|main\.ts)$/.test(file) ? 'restart' : null;
}

const pending = new Set<string>();
let timer: ReturnType<typeof setTimeout> | undefined;
let queue = Promise.resolve();

function changed(root: string, name: string | null) {
  if (!name) return;
  pending.add(repoPath(path.join(root, name)));
  clearTimeout(timer);
  timer = setTimeout(() => {
    queue = queue.then(apply).catch((error) => console.error(`[dev] ${error?.message ?? error}`));
  }, 100);
}

async function apply() {
  const actions = [...pending].map(classify).filter((a) => a !== null);
  pending.clear();
  if (actions.includes('restart')) return buildAll().then(restart);
  if (actions.includes('reload')) return rebuildApp().then(() => notify({ reload: true }));

  const plugins = [...new Set(actions.map((a) => (a as { plugin: string }).plugin))];
  if (!plugins.length) return;
  await Promise.all(plugins.map(buildHotPlugin));
  await notify({ plugins });
  await rebuildApp();
}

for (const root of [SRC, THEMES]) watch(root, { recursive: true }, (_event, name) => changed(root, name));
console.log('[dev] watching for changes');
