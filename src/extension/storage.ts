import { MAX_KEYS, MAX_BLOB, RENDERERS, record, validRequest, validResponse } from './rpc.ts';
import type { Request, Response, StorageArea } from './rpc.ts';

export const SETTINGS_KEY = 'slick:firefox:settings';
export const CSS_KEY = 'slick:firefox:css';
export const BLOB_PREFIX = 'slick:firefox:blobs:';
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
export function createStorage(area: StorageArea) {
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
    const key = BLOB_PREFIX + a[0];
    const stored = await read(key, {});
    if (
      !record(stored) ||
      Object.keys(stored).length > MAX_KEYS ||
      !Object.values(stored).every((v) => typeof v === 'string' && v.length <= MAX_BLOB)
    )
      throw new Error('Invalid blob storage');
    const blobs = Object.assign(Object.create(null), stored) as Record<string, string>;
    switch (method) {
      case 'blob.list':
        return Object.keys(blobs);
      case 'blob.read':
        return blobs[a[1]] ?? null;
      case 'blob.readAll':
        return Object.fromEntries(Object.entries(blobs).filter(([k]) => k.startsWith(a[1])));
      case 'blob.write':
        if (!(a[1] in blobs) && Object.keys(blobs).length >= MAX_KEYS) throw new Error('Blob quota exceeded');
        blobs[a[1]] = a[2];
        if (Object.values(blobs).reduce((sum, v) => sum + v.length, 0) > 512 * 1024)
          throw new Error('Blob quota exceeded');
        break;
      case 'blob.delete':
        delete blobs[a[1]];
        break;
      case 'blob.clear':
        await area.set({ [key]: {} });
        return true;
      default:
        throw new Error('Unsupported storage method');
    }
    await area.set({ [key]: blobs });
    return true;
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
