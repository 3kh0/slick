// Public page traffic is not secret or authenticated. Keep this surface unprivileged.
import type { Dnr } from './mainHost.ts';
import { BACKGROUND_PLUGINS, EXTENSION_PLUGINS, LARGE_STORAGE_PLUGINS } from './plugins.ts';

export const CHANNEL = 'slick:firefox:v1';
export const RENDERERS = EXTENSION_PLUGINS;
export const MAX_TEXT = 256 * 1024;
export const MAX_BLOB = 64 * 1024;
export const MAX_KEYS = 128;
export const PAGE_KEYS = 512;
export const MAX_PENDING = 64;
export const METHODS = [
  'readSettings',
  'writeSettings',
  'compareAndSwapSettings',
  'readUserCss',
  'writeUserCss',
  'openCssEditor',
  'blob.list',
  'blob.read',
  'blob.readAll',
  'blob.write',
  'blob.delete',
  'blob.clear',
  'plugin.call',
  'tabMode',
] as const;
export type Method = (typeof METHODS)[number];
// Options UI: runtime.sendMessage({method,args}) -> {ok:true,value}|{ok:false,error}.
// Use compareAndSwapSettings [expectedText,newText] and retry on false, not read/write.
export type Request = { method: Method; args: string[] };
export type Response =
  | { ok: true; value: string | boolean | null | string[] | Record<string, string> }
  | { ok: false; error: string };
export function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
const text = (v: unknown, max = MAX_TEXT): v is string => typeof v === 'string' && v.length <= max;
// PluginManager namespaces blob stores as `plugin:<id>`.
export function namespace(v: unknown): v is string {
  return typeof v === 'string' && v.startsWith('plugin:') && (RENDERERS as readonly string[]).includes(v.slice(7));
}
// Per-namespace quota. Logging plugins get room for their history (MessageLogger keeps 1000 entries).
export function blobLimits(ns: string) {
  return (LARGE_STORAGE_PLUGINS as readonly string[]).includes(ns.slice(7))
    ? // A key plus its value must fit one readAll page.
      { keys: 5000, value: MAX_TEXT - 128, bytes: 64 * 1024 * 1024 }
    : { keys: MAX_KEYS, value: MAX_BLOB, bytes: 512 * 1024 };
}
// Empty keys are refused (as on desktop), so '' can mean "from the start" in a page cursor.
const blobKey = (v: unknown): v is string => text(v, 128) && v.length > 0;
export function validRequest(v: unknown): v is Request {
  if (!record(v) || !Array.isArray(v.args) || typeof v.method !== 'string') return false;
  const a = v.args;
  switch (v.method) {
    case 'readSettings':
    case 'readUserCss':
    case 'openCssEditor':
      return a.length === 0;
    case 'writeSettings':
    case 'writeUserCss':
      return a.length === 1 && text(a[0]);
    case 'compareAndSwapSettings':
      return a.length === 2 && a.every((x) => text(x));
    case 'blob.clear':
      return a.length === 1 && namespace(a[0]);
    // [namespace, cursor]: keys after the cursor ('' for the first page).
    case 'blob.list':
      return a.length === 2 && namespace(a[0]) && text(a[1], 128);
    case 'blob.read':
    case 'blob.delete':
      return a.length === 2 && namespace(a[0]) && blobKey(a[1]);
    // [namespace, prefix, cursor]
    case 'blob.readAll':
      return a.length === 3 && namespace(a[0]) && text(a[1], 128) && text(a[2], 128);
    case 'blob.write':
      return a.length === 3 && namespace(a[0]) && blobKey(a[1]) && text(a[2], blobLimits(a[0]).value);
    // [plugin id, rpc method, JSON-encoded argument array]
    case 'plugin.call':
      return (
        a.length === 3 &&
        (BACKGROUND_PLUGINS as readonly unknown[]).includes(a[0]) &&
        typeof a[1] === 'string' &&
        /^[A-Za-z]\w{0,63}$/.test(a[1]) &&
        text(a[2])
      );
    case 'tabMode':
      return a.length === 1 && ['normal', 'safe', 'bypass'].includes(a[0]);
    default:
      return false;
  }
}
export function validResponse(v: unknown): v is Response {
  if (!record(v)) return false;
  if (v.ok === false) return text(v.error, 256);
  if (v.ok !== true) return false;
  const x = v.value;
  if (x === null || typeof x === 'boolean' || text(x)) return true;
  if (Array.isArray(x)) return x.length <= PAGE_KEYS && x.every((s) => text(s, 128));
  if (!record(x) || Object.keys(x).length > PAGE_KEYS) return false;
  let size = 0;
  for (const [k, s] of Object.entries(x)) {
    if (!text(k, 128) || typeof s !== 'string') return false;
    size += k.length + s.length;
  }
  return size <= MAX_TEXT;
}
export function validMethodResponse(method: Method, response: unknown): response is Response {
  if (!validResponse(response)) return false;
  if (!response.ok) return true;
  const value = response.value;
  if (method === 'readSettings' || method === 'readUserCss') return typeof value === 'string';
  if (method === 'blob.read') return value === null || typeof value === 'string';
  if (method === 'blob.list') return Array.isArray(value);
  if (method === 'blob.readAll') return record(value);
  if (method === 'plugin.call') return typeof value === 'string';
  return typeof value === 'boolean';
}
export function validId(v: unknown): v is string {
  return typeof v === 'string' && /^[a-z0-9-]{1,80}$/.test(v);
}
export type Sender = { id?: string; frameId?: number; url?: string; tab?: { id?: number } };
// Tiny extension-local browser surface; compatible with @types/firefox-webext-browser.
export type StorageArea = {
  get(keys: string | string[]): Promise<Record<string, unknown>>;
  set(items: Record<string, unknown>): Promise<void>;
  remove(keys: string | string[]): Promise<void>;
};
export type ExtensionBrowser = {
  runtime: {
    id: string;
    getURL(path: string): string;
    sendMessage(message: Request): Promise<unknown>;
    onMessage: { addListener(cb: (message: unknown, sender: Sender) => Promise<Response>): void };
  };
  storage: {
    local: StorageArea;
    onChanged: { addListener(cb: (changes: Record<string, { newValue?: unknown }>, area: string) => void): void };
  };
  tabs: {
    create(options: { url: string }): Promise<unknown>;
    onRemoved?: { addListener(cb: (tabId: number) => void): void };
  };
  declarativeNetRequest?: Dnr;
  action?: { setIcon(details: { path: string | null }): Promise<void> };
};
export function extensionBrowser(): ExtensionBrowser | undefined {
  return (globalThis as typeof globalThis & { browser?: ExtensionBrowser }).browser;
}

export function createClient(send: (message: unknown) => void, timeout = 10000) {
  const pending = new Map<
    string,
    {
      method: Method;
      resolve: (value: unknown) => void;
      reject: (error: Error) => void;
      timer: ReturnType<typeof setTimeout>;
    }
  >();
  let closed = false;
  let sequence = 0;
  const prefix = Math.random().toString(36).slice(2);
  function disconnect() {
    closed = true;
    for (const p of pending.values()) {
      clearTimeout(p.timer);
      p.reject(new Error('Extension disconnected'));
    }
    pending.clear();
  }
  return {
    disconnect,
    receive(message: unknown) {
      if (
        !record(message) ||
        message.channel !== CHANNEL ||
        message.kind !== 'response' ||
        !validId(message.id) ||
        !validResponse(message.response)
      )
        return;
      const p = pending.get(message.id);
      if (!p || !validMethodResponse(p.method, message.response)) return;
      pending.delete(message.id);
      clearTimeout(p.timer);
      if (message.response.ok) p.resolve(message.response.value);
      else p.reject(new Error(message.response.error));
    },
    call<T>(method: Method, ...args: string[]): Promise<T> {
      if (closed || pending.size >= MAX_PENDING || !validRequest({ method, args }))
        return Promise.reject(new Error('Extension request unavailable'));
      return new Promise<T>((resolve, reject) => {
        const id = `${prefix}-${++sequence}`;
        const timer = setTimeout(() => {
          pending.delete(id);
          reject(new Error('Extension request timed out'));
        }, timeout);
        pending.set(id, { method, resolve: (value) => resolve(value as T), reject, timer });
        try {
          send({ channel: CHANNEL, kind: 'request', id, method, args });
        } catch {
          pending.delete(id);
          clearTimeout(timer);
          reject(new Error('Extension send failed'));
        }
      });
    },
  };
}
