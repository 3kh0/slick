import { createBlobs, type BlobBackend } from './blobs.ts';
import { RENDERERS, record, validRequest, validResponse } from './rpc.ts';
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
// One instance in the background owns all writes, including UI writes. Never write
// storage.local directly from options: doing so bypasses serialization and CAS.
export function createStorage(area: StorageArea, backend: BlobBackend) {
  const blobs = createBlobs(area, backend);
  let tail = Promise.resolve();
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
    return blobs({ method, args: a });
  }
  return {
    dispatch(request: unknown): Promise<Response> {
      if (!validRequest(request)) return Promise.resolve({ ok: false, error: 'Invalid request' });
      const result = tail.then(async (): Promise<Response> => {
        try {
          const response = { ok: true, value: await execute(request) };
          return validResponse(response) ? response : { ok: false, error: 'Invalid stored value' };
        } catch {
          return { ok: false, error: 'Storage request failed' };
        }
      });
      tail = result.then(() => {});
      return result;
    },
  };
}
