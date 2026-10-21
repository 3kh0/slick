import { createBlobs, type BlobBackend } from './blobs.ts';
import { RENDERERS, bundled, record, validRequest, validResponse } from './rpc.ts';
import { USER_PLUGINS_KEY, installedPlugins } from './userPlugins.ts';
import type { Request, Response, StorageArea } from './rpc.ts';

export const SETTINGS_KEY = 'slick:firefox:settings';
export const CSS_KEY = 'slick:firefox:css';
// Plugins are opt-in individually. No global off: Slack's Preferences tab has no
// global switch, so a plugin enabled there would silently never start.
export const DEFAULT_SETTINGS = JSON.stringify({
  plugins: Object.fromEntries(RENDERERS.map((id) => [id, { enabled: false }])),
});
export function validConfig(text: string): boolean {
  try {
    return record(JSON.parse(text));
  } catch {
    return false;
  }
}
// One background instance owns all writes, including UI writes. Serialize each
// resource so CAS and blob quotas stay atomic without making settings wait for
// an unrelated archive. UI writes must still go through this dispatcher.
export function createStorage(area: StorageArea, backend: BlobBackend) {
  const blobs = createBlobs(area, backend);
  const tails = new Map<string, Promise<void>>();
  async function execute({ method, args: a }: Request): Promise<unknown> {
    const read = async (key: string, fallback: unknown) => (await area.get(key))[key] ?? fallback;
    if (method === 'readSettings') return read(SETTINGS_KEY, DEFAULT_SETTINGS);
    if (method === 'readUserCss') return read(CSS_KEY, '');
    if (method === 'writeUserCss') {
      await area.set({ [CSS_KEY]: a[0] });
      return true;
    }
    if (method === 'writeSettings' || method === 'compareAndSwapSettings') {
      const next = a[method === 'writeSettings' ? 0 : 1];
      if (!validConfig(next)) throw new Error('Invalid settings');
      if (method === 'compareAndSwapSettings' && (await read(SETTINGS_KEY, DEFAULT_SETTINGS)) !== a[0]) return false;
      await area.set({ [SETTINGS_KEY]: next });
      return true;
    }
    if (!bundled(a[0]) && !Object.hasOwn(installedPlugins(await read(USER_PLUGINS_KEY, {})), a[0].slice(7)))
      throw new Error('Unknown plugin');
    return blobs({ method, args: a });
  }
  return {
    dispatch(request: unknown): Promise<Response> {
      if (!validRequest(request)) return Promise.resolve({ ok: false, error: 'Invalid request' });
      const resource = request.method.startsWith('blob.')
        ? `blob:${request.args[0]}`
        : request.method === 'readUserCss' || request.method === 'writeUserCss'
          ? 'css'
          : 'settings';
      const prior = tails.get(resource) ?? Promise.resolve();
      const result = prior.then(async (): Promise<Response> => {
        try {
          const response = { ok: true, value: await execute(request) };
          return validResponse(response) ? response : { ok: false, error: 'Invalid stored value' };
        } catch {
          return { ok: false, error: 'Storage request failed' };
        }
      });
      const tail = result.then(() => {
        if (tails.get(resource) === tail) tails.delete(resource);
      });
      tails.set(resource, tail);
      return result;
    },
  };
}
