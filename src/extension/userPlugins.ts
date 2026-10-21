// Plugin files installed from the options page (`bun run build:plugin` output),
// registered as MAIN-world user scripts that queue themselves for the page.
import { record } from '../shared/objects.ts';

export const USER_PLUGINS_KEY = 'slick:extension:user-plugins';
export const USER_PLUGIN_ID = /^[A-Za-z0-9_.-]{1,100}$/;
const MAX_CODE = 4 * 1024 * 1024;

export type UserPlugin = {
  id: string;
  name: string;
  description: string;
  code: string;
};
type Script = {
  id: string;
  matches: string[];
  js: { code: string }[];
  runAt: 'document_start';
  world: 'MAIN';
};
export type UserScripts = {
  getScripts(filter?: { ids?: string[] }): Promise<{ id: string }[]>;
  register(scripts: Script[]): Promise<void>;
  unregister(filter?: { ids?: string[] }): Promise<void>;
};

const text = (value: unknown, max: number) => (typeof value === 'string' ? value.slice(0, max) : '');

export function parsePluginFile(code: string): UserPlugin {
  let meta: unknown = null;
  try {
    meta = JSON.parse(/^\/\/ slick-plugin (.+)\n/.exec(code)?.[1] ?? 'null');
  } catch {}
  if (!record(meta) || typeof meta.id !== 'string' || !USER_PLUGIN_ID.test(meta.id))
    throw new Error('That file is not a Slick plugin. Build one with bun run build:plugin.');
  if (code.length > MAX_CODE) throw new Error('Plugin files must be smaller than 4 MiB.');
  return {
    id: meta.id,
    name: text(meta.name, 200) || meta.id,
    description: text(meta.description, 1000),
    code,
  };
}

export function installedPlugins(value: unknown): Record<string, UserPlugin> {
  if (!record(value)) return {};
  const plugins: Record<string, UserPlugin> = {};
  for (const [id, plugin] of Object.entries(value))
    if (USER_PLUGIN_ID.test(id) && record(plugin) && plugin.id === id && typeof plugin.code === 'string')
      plugins[id] = {
        id,
        name: text(plugin.name, 200) || id,
        description: text(plugin.description, 1000),
        code: plugin.code,
      };
  return plugins;
}

/** The API, or null while its permission (or Chromium's Allow User Scripts toggle) is off. */
export function userScripts(api: { userScripts?: UserScripts }): UserScripts | null {
  try {
    void api.userScripts!.getScripts().catch(() => {});
    return api.userScripts!;
  } catch {
    return null;
  }
}

export async function syncUserScripts(scripts: UserScripts, plugins: Record<string, UserPlugin>) {
  await scripts.unregister();
  const all = Object.values(plugins);
  if (!all.length) return;
  await scripts.register(
    all.map((plugin) => ({
      id: `plugin-${plugin.id}`,
      matches: ['https://app.slack.com/client', 'https://app.slack.com/client/*'],
      js: [{ code: plugin.code }],
      runAt: 'document_start',
      world: 'MAIN',
    })),
  );
}
