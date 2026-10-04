export type Gif = {
  provider: 'tenor' | 'giphy' | 'klipy';
  id: string;
  name: string;
  url: string;
  previewUrl: string;
  animationUrl?: string;
  width: number;
  height: number;
  bytes?: number;
  previewBytes?: number;
  pageUrl?: string;
};

export const MAX_FAVORITES = 200;

const MAX_NAME = 200;
const MAX_DIMENSION = 10_000;
const MAX_BYTES = 1024 * 1024 * 1024;
const MAX_BODY_BYTES = 2 * 1024 * 1024;
// oxlint-disable-next-line no-control-regex
const CONTROL = /[\u0000-\u001f\u007f-\u009f]/;
const MEDIA_HOSTS = {
  tenor: /^media(?:[0-9]+)?\.tenor\.com$/,
  giphy: /^(?:media(?:[0-9]+)?|i)\.giphy\.com$/,
  klipy: /^(?:[a-z0-9-]+\.)?klipy\.com$/,
};
const PAGE_HOSTS = {
  tenor: /^(?:www\.)?tenor\.com$/,
  giphy: /^(?:www\.)?giphy\.com$/,
  klipy: /^(?:www\.)?klipy\.com$/,
};

type RecordValue = Record<string, unknown>;

function record(value: unknown): RecordValue | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? (value as RecordValue) : null;
}

function boundedInteger(value: unknown, min: number, max: number): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= min && value <= max;
}

function validName(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0 && value.length <= MAX_NAME && !CONTROL.test(value);
}

function validUrl(value: unknown, hosts: RegExp): value is string {
  if (
    typeof value !== 'string' ||
    value.length > 4096 ||
    !/^https:\/\//i.test(value) ||
    /[\s\\]/.test(value) ||
    CONTROL.test(value) ||
    /%(?:0[0-9a-f]|1[0-9a-f]|7f)/i.test(value)
  )
    return false;
  try {
    const url = new URL(value);
    return (
      url.protocol === 'https:' && hosts.test(url.hostname) && !url.username && !url.password && !url.port && !url.hash
    );
  } catch {
    return false;
  }
}

function validateGif(value: unknown): Gif | null {
  const item = record(value);
  if (!item || (item.provider !== 'tenor' && item.provider !== 'giphy' && item.provider !== 'klipy')) return null;
  const provider = item.provider;
  if (
    typeof item.id !== 'string' ||
    CONTROL.test(item.id) ||
    !(provider === 'tenor' ? /^[0-9]{1,100}$/ : /^[a-zA-Z0-9_-]{1,128}$/).test(item.id) ||
    !validName(item.name) ||
    !validUrl(item.url, MEDIA_HOSTS[provider]) ||
    !validUrl(item.previewUrl, MEDIA_HOSTS[provider]) ||
    (item.animationUrl !== undefined && !validUrl(item.animationUrl, MEDIA_HOSTS[provider])) ||
    !boundedInteger(item.width, 1, MAX_DIMENSION) ||
    !boundedInteger(item.height, 1, MAX_DIMENSION) ||
    (item.bytes !== undefined && !boundedInteger(item.bytes, 0, MAX_BYTES)) ||
    (item.previewBytes !== undefined && !boundedInteger(item.previewBytes, 0, MAX_BYTES)) ||
    (item.pageUrl !== undefined && !validUrl(item.pageUrl, PAGE_HOSTS[provider]))
  )
    return null;

  return {
    provider,
    id: item.id,
    name: item.name.trim(),
    url: item.url,
    previewUrl: item.previewUrl,
    ...(item.animationUrl !== undefined ? { animationUrl: item.animationUrl as string } : {}),
    width: item.width,
    height: item.height,
    ...(item.bytes !== undefined ? { bytes: item.bytes as number } : {}),
    ...(item.previewBytes !== undefined ? { previewBytes: item.previewBytes as number } : {}),
    ...(item.pageUrl !== undefined ? { pageUrl: item.pageUrl as string } : {}),
  };
}

/** Proxy fields are preferred; older Tenor media records can supply missing dimensions. */
export function normalizeTenorResponse(value: unknown): Gif[] {
  const results = record(value)?.results;
  if (!Array.isArray(results)) return [];
  const gifs: Gif[] = [];
  for (const result of results) {
    const item = record(result);
    if (!item) continue;
    const media = record(Array.isArray(item.media) ? item.media[0] : item.media);
    const original = record(media?.gif);
    const preview = record(media?.tinygif) ?? record(media?.nanogif);
    const dims = Array.isArray(original?.dims) ? original.dims : [];
    // Missing/null dimensions may fall back, but explicit invalid numbers must not.
    const gif = validateGif({
      provider: 'tenor',
      id: item.id,
      name: item.title === undefined || item.title === '' ? (item.description ?? 'GIF') : item.title,
      url: item.gif ?? original?.url,
      previewUrl: item.preview ?? preview?.url,
      animationUrl: preview?.url,
      width: item.width ?? dims[0] ?? original?.width,
      height: item.height ?? dims[1] ?? original?.height,
      pageUrl: item.url,
      bytes: original?.size,
      previewBytes: preview?.size,
    });
    if (gif) gifs.push(gif);
  }
  return gifs;
}

function klipyFile(value: unknown): RecordValue | null {
  const sizes = record(value);
  if (!sizes) return null;
  return record(sizes.gif);
}

/** KLIPY returns `{ result, data: { data: [...] } }`; each item lists gif/webp/mp4 files per size (hd, md, sm, xs). */
export function normalizeKlipyResponse(value: unknown): Gif[] {
  const items = record(record(value)?.data)?.data;
  if (!Array.isArray(items)) return [];
  const gifs: Gif[] = [];
  for (const entry of items) {
    const item = record(entry);
    // Ads (type "ad") and non-GIF entries have no slug or file sizes and are skipped.
    if (!item || item.type === 'ad') continue;
    const file = record(item.file);
    const main = klipyFile(file?.md) ?? klipyFile(file?.hd) ?? klipyFile(file?.sm);
    const preview = klipyFile(file?.sm) ?? klipyFile(file?.xs) ?? main;
    const slug = item.slug;
    const gif = validateGif({
      provider: 'klipy',
      id: slug,
      name: item.title === undefined || item.title === '' ? 'GIF' : item.title,
      url: main?.url,
      previewUrl: preview?.url,
      animationUrl: preview?.url,
      width: main?.width,
      height: main?.height,
      pageUrl: typeof slug === 'string' ? `https://klipy.com/gifs/${slug}` : undefined,
      bytes: main?.size,
      previewBytes: preview?.size,
    });
    if (gif) gifs.push(gif);
  }
  return gifs;
}

/** Named GifListItem props, not a positional component argument list. */
export function fromGiphyProps(value: unknown): Gif | null {
  const props = record(value);
  if (!props) return null;
  return validateGif({
    provider: 'giphy',
    id: props.id,
    name: props.name,
    url: props.url,
    previewUrl: props.previewUrl,
    width: props.width,
    height: props.height,
    bytes: props.bytes,
    previewBytes: props.previewBytes,
  });
}

export function toSlackPayload(gif: Gif): {
  originalGifUrl: string;
  previewUrl: string;
  name: string;
  width: number;
  height: number;
  bytes?: number;
  previewBytes?: number;
} {
  return {
    originalGifUrl: gif.url,
    previewUrl: gif.previewUrl,
    name: gif.name,
    width: gif.width,
    height: gif.height,
    ...(gif.bytes !== undefined ? { bytes: gif.bytes } : {}),
    ...(gif.previewBytes !== undefined ? { previewBytes: gif.previewBytes } : {}),
  };
}

export function gifKey(gif: Gif): string {
  return `${gif.provider}:${gif.id}`;
}

export function parseFavorites(value: unknown): Gif[] {
  const stored = record(value);
  if (stored?.version !== 1 || !Array.isArray(stored.gifs)) return [];
  const gifs: Gif[] = [];
  const seen = new Set<string>();
  for (const item of stored.gifs) {
    const gif = validateGif(item);
    if (!gif || seen.has(gifKey(gif))) continue;
    seen.add(gifKey(gif));
    gifs.push(gif);
    if (gifs.length === MAX_FAVORITES) break;
  }
  return gifs;
}

type Storage = {
  get<T>(key: string, fallback: T): Promise<T>;
  set(key: string, value: unknown): Promise<boolean>;
};

export class Favorites {
  private storage: Storage;
  private changed: (gifs: Gif[]) => void;
  private gifs: Gif[] = [];
  private loading: Promise<void> | undefined;
  private updates: Promise<void> = Promise.resolve();

  constructor(storage: Storage, changed: (gifs: Gif[]) => void) {
    this.storage = storage;
    this.changed = changed;
  }

  load(): Promise<void> {
    if (!this.loading) {
      this.loading = this.storage
        .get<unknown>('favorites', { version: 1, gifs: [] })
        .then((value) => {
          this.gifs = parseFavorites(value);
          this.changed(this.current());
        })
        .catch((error: unknown) => {
          this.loading = undefined;
          throw error;
        });
    }
    return this.loading;
  }

  current(): Gif[] {
    return this.gifs.map((gif) => ({ ...gif }));
  }

  toggle(gif: Gif): Promise<void> {
    // Snapshot now so callers cannot mutate a queued operation's input.
    const validated = validateGif(gif);
    const update = this.updates.then(async () => {
      if (!validated) throw new Error('Invalid favorite GIF.');
      await this.load();
      const key = gifKey(validated);
      const exists = this.gifs.some((item) => gifKey(item) === key);
      if (!exists && this.gifs.length >= MAX_FAVORITES) {
        throw new Error(`Favorites limit reached (${MAX_FAVORITES}).`);
      }
      const next = exists ? this.gifs.filter((item) => gifKey(item) !== key) : [...this.gifs, validated];
      if (
        !(await this.storage.set('favorites', {
          version: 1,
          gifs: next.map((item) => ({ ...item })),
        }))
      ) {
        throw new Error('Could not save favorites.');
      }
      this.gifs = next;
      this.changed(this.current());
    });
    this.updates = update.catch(() => {});
    return update;
  }
}

export async function searchTenor(
  fetcher: (url: string, init?: RequestInit) => Promise<{ status: number; body: string }>,
  query: string,
): Promise<Gif[]> {
  if (typeof query !== 'string' || CONTROL.test(query)) throw new Error('Invalid GIF search query.');
  const normalized = query.trim().replace(/\s+/g, ' ');
  if (!normalized || normalized.length > 100) throw new Error('GIF search query must be 1–100 characters.');
  const url = new URL('https://tenor-proxy.vercel.app/api/search');
  // https://github.com/3kh0/tenor-proxy
  url.searchParams.set('q', normalized);
  url.searchParams.set('limit', '50');
  return fetchGifs(fetcher, url, 'GIF search', 'tenor');
}

export function topTenor(
  fetcher: (url: string, init?: RequestInit) => Promise<{ status: number; body: string }>,
): Promise<Gif[]> {
  return fetchGifs(fetcher, new URL('https://tenor-proxy.vercel.app/api/top?limit=50'), 'Top GIF', 'tenor');
}

type Fetcher = (url: string, init?: RequestInit) => Promise<{ status: number; body: string }>;

const KLIPY_KEY = /^[A-Za-z0-9_-]{8,128}$/;

function klipyUrl(apiKey: string, endpoint: 'search' | 'trending', params: Record<string, string>): URL {
  const key = typeof apiKey === 'string' ? apiKey.trim() : '';
  if (!KLIPY_KEY.test(key)) throw new Error('Add your KLIPY API key in the Better GIFs settings.');
  const url = new URL(`https://api.klipy.com/api/v1/${key}/gifs/${endpoint}`);
  for (const [name, value] of Object.entries(params)) url.searchParams.set(name, value);
  url.searchParams.set('per_page', '50');
  url.searchParams.set('customer_id', 'slick');
  return url;
}

export async function searchKlipy(fetcher: Fetcher, apiKey: string, query: string): Promise<Gif[]> {
  if (typeof query !== 'string' || CONTROL.test(query)) throw new Error('Invalid GIF search query.');
  const normalized = query.trim().replace(/\s+/g, ' ');
  if (!normalized || normalized.length > 100) throw new Error('GIF search query must be 1–100 characters.');
  return fetchGifs(fetcher, klipyUrl(apiKey, 'search', { q: normalized }), 'GIF search', 'klipy');
}

export async function topKlipy(fetcher: Fetcher, apiKey: string): Promise<Gif[]> {
  return fetchGifs(fetcher, klipyUrl(apiKey, 'trending', {}), 'Top GIF', 'klipy');
}

export function filterFavorites(gifs: Gif[], query: string): Gif[] {
  const words = query.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean);
  return gifs.filter((gif) => {
    const text = `${gif.name} ${gif.provider}`.toLocaleLowerCase();
    return words.every((word) => text.includes(word));
  });
}

async function fetchGifs(
  fetcher: (url: string, init?: RequestInit) => Promise<{ status: number; body: string }>,
  url: URL,
  label: string,
  provider: 'tenor' | 'klipy',
): Promise<Gif[]> {
  let response: { status: number; body: string };
  try {
    response = await fetcher(url.href);
  } catch {
    throw new Error(`${label} network request failed.`);
  }
  if (!response || !Number.isInteger(response.status) || response.status < 200 || response.status >= 300) {
    const status = Number.isInteger(response?.status) ? ` (HTTP ${response.status})` : '';
    throw new Error(`${label} request failed${status}.`);
  }
  if (typeof response.body !== 'string') throw new Error(`${label} returned an invalid response.`);
  if (response.body.length > MAX_BODY_BYTES || new TextEncoder().encode(response.body).length > MAX_BODY_BYTES) {
    throw new Error(`${label} response is too large.`);
  }
  let value: unknown;
  try {
    value = JSON.parse(response.body);
  } catch {
    throw new Error(`${label} returned invalid JSON.`);
  }
  if (provider === 'klipy') {
    const body = record(value);
    if (body?.result === false) throw new Error(`${label} was rejected. Check your KLIPY API key.`);
    if (!Array.isArray(record(body?.data)?.data)) throw new Error(`${label} returned an invalid response.`);
    return normalizeKlipyResponse(value);
  }
  if (!Array.isArray(record(value)?.results)) throw new Error(`${label} returned an invalid response.`);
  return normalizeTenorResponse(value);
}
