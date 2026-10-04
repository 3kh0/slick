import type { SlackMessage } from '$slick';

export type SavedImage = { name: string; data: string };
type ImageSource = { name: string; urls: string[] };
type Store = {
  entries<T>(prefix: string): Promise<Map<string, T>>;
  set(key: string, value: unknown): Promise<boolean>;
  delete(key: string): Promise<boolean>;
};

const PREFIX = 'images:';
const MAX_IMAGES = 3;
const MAX_IMAGE_BYTES = 48 * 1024;
const MAX_DOWNLOAD_BYTES = 2 * 1024 * 1024;
const MAX_ARCHIVED = 128;
const MAX_RECENT = 64;
const RASTER = /^image\/(png|jpeg|gif|webp)$/i;

function urls(values: unknown[]): string[] {
  return [
    ...new Set(
      values.filter((value): value is string => {
        if (typeof value !== 'string') return false;
        try {
          return new URL(value).protocol === 'https:';
        } catch {
          return false;
        }
      }),
    ),
  ];
}

/** Prefer a Slack preview: originals can be huge, and private URLs need session cookies. */
export function imageSources(message: SlackMessage): ImageSource[] {
  const sources: ImageSource[] = [];
  for (const file of Array.isArray(message.files) ? message.files : []) {
    if (!file || typeof file !== 'object' || typeof file.mimetype !== 'string' || !RASTER.test(file.mimetype)) continue;
    sources.push({
      name: String(file.title || file.name || 'Deleted image').slice(0, 200),
      urls: urls([file.thumb_720, file.thumb_480, file.thumb_360, file.url_private, file.url_private_download]),
    });
  }
  for (const attachment of message.attachments ?? []) {
    sources.push({
      name: String(attachment.title || 'Deleted image').slice(0, 200),
      urls: urls([attachment.image_url, attachment.thumb_url]),
    });
  }
  for (const block of Array.isArray(message.blocks) ? message.blocks : []) {
    if (block?.type === 'image')
      sources.push({ name: String(block.alt_text || 'Deleted image').slice(0, 200), urls: urls([block.image_url]) });
  }
  const seen = new Set<string>();
  return sources
    .filter((source) => {
      if (!source.urls.length || seen.has(source.urls[0])) return false;
      seen.add(source.urls[0]);
      return true;
    })
    .slice(0, MAX_IMAGES);
}

function dataURL(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.addEventListener('load', () => resolve(String(reader.result)), { once: true });
    reader.addEventListener('error', () => reject(reader.error), { once: true });
    reader.readAsDataURL(blob);
  });
}

export async function downloadImage(url: string, signal: AbortSignal): Promise<string | null> {
  const response = await fetch(url, {
    credentials: 'include',
    signal: AbortSignal.any([signal, AbortSignal.timeout(10_000)]),
  });
  const type = response.headers.get('content-type')?.split(';')[0].trim() ?? '';
  if (
    !response.ok ||
    !RASTER.test(type) ||
    Number(response.headers.get('content-length')) > MAX_DOWNLOAD_BYTES ||
    !response.body
  ) {
    await response.body?.cancel();
    return null;
  }
  const reader = response.body.getReader();
  const parts: Uint8Array<ArrayBuffer>[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > MAX_DOWNLOAD_BYTES) return null;
      parts.push(new Uint8Array(value));
    }
  } finally {
    await reader.cancel();
  }
  const blob = new Blob(parts, { type });
  if (blob.size <= MAX_IMAGE_BYTES) return dataURL(blob);
  const bitmap = await createImageBitmap(blob);
  try {
    const scale = Math.min(1, 800 / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(bitmap.width * scale));
    canvas.height = Math.max(1, Math.round(bitmap.height * scale));
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;
    ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    for (const quality of [0.8, 0.5, 0.3]) {
      const data = canvas.toDataURL('image/webp', quality);
      if (data.length <= (MAX_IMAGE_BYTES * 4) / 3 + 64) return data;
    }
    return null;
  } finally {
    bitmap.close();
  }
}

function validImages(value: unknown): value is SavedImage[] {
  return (
    Array.isArray(value) &&
    value.length <= MAX_IMAGES &&
    value.every(
      (image) =>
        typeof image?.name === 'string' &&
        image.name.length <= 200 &&
        typeof image.data === 'string' &&
        /^data:image\/(png|jpeg|gif|webp);base64,[A-Za-z0-9+/=]+$/.test(image.data) &&
        image.data.length <= (MAX_IMAGE_BYTES * 4) / 3 + 64,
    )
  );
}

/** Image bytes stay separate from the 32 KB message cap and fit extension storage quotas. */
export class ImageArchive {
  private recent = new Map<string, SavedImage[]>();
  private archived = new Map<string, SavedImage[]>();
  private retained = new Set<string>();
  private attempted = new Map<string, string>();
  private pending = new Map<string, object>();
  private writes: Promise<unknown> = Promise.resolve();
  private store: Store;
  private signal: AbortSignal;
  private changed: () => void;
  private download: typeof downloadImage;

  constructor(store: Store, signal: AbortSignal, changed: () => void, download = downloadImage) {
    this.store = store;
    this.signal = signal;
    this.changed = changed;
    this.download = download;
  }

  async restore(keys: () => Iterable<string>) {
    const stored = await this.store.entries<unknown>(PREFIX);
    if (this.signal.aborted) return;
    this.retained = new Set(keys());
    for (const [key, images] of stored) {
      const id = key.slice(PREFIX.length);
      if (!this.retained.has(id) || !validImages(images)) this.remove(id);
      else if (!this.archived.has(id)) this.archived.set(id, images);
    }
    this.cap();
    this.changed();
  }

  get(key: string): SavedImage[] {
    return this.archived.get(key) ?? [];
  }

  capture(key: string, message: SlackMessage) {
    if (this.signal.aborted || this.archived.has(key)) return;
    // A deletion payload can omit files or refer to already-tombstoned metadata.
    if (this.retained.has(key) && this.pending.has(key)) return;
    const sources = imageSources(message);
    const signature = JSON.stringify(sources);
    if (this.attempted.get(key) === signature) return;
    if (this.pending.size >= 8 && !this.pending.has(key)) return;
    this.pending.delete(key);
    this.attempted.set(key, signature);
    while (this.attempted.size > 400) this.attempted.delete(this.attempted.keys().next().value!);
    // Drop a cached preview when an edit replaces its image.
    this.recent.delete(key);
    if (!sources.length) return;
    const token = {};
    this.pending.set(key, token);
    void (async () => {
      const images: SavedImage[] = [];
      for (const source of sources) {
        for (const url of source.urls) {
          if (this.signal.aborted || this.pending.get(key) !== token) return;
          try {
            const data = await this.download(url, this.signal);
            if (!data) continue;
            images.push({ name: source.name, data });
            break;
          } catch {
            // Deleted, inaccessible or offline images must not interrupt logging.
          }
        }
      }
      if (this.signal.aborted || this.pending.get(key) !== token || !images.length) return;
      this.recent.set(key, images);
      while (this.recent.size > MAX_RECENT) this.recent.delete(this.recent.keys().next().value!);
      if (this.retained.has(key)) this.retain(key);
    })().finally(() => {
      if (this.pending.get(key) === token) this.pending.delete(key);
    });
  }

  retain(key: string) {
    this.retained.add(key);
    const images = this.recent.get(key);
    if (!images) return;
    this.recent.delete(key);
    this.archived.set(key, images);
    this.enqueue(() => this.store.set(`${PREFIX}${key}`, images));
    this.cap();
    this.changed();
  }

  forget(key: string) {
    this.retained.delete(key);
    this.pending.delete(key);
    this.recent.delete(key);
    this.attempted.delete(key);
    this.archived.delete(key);
    this.remove(key);
  }

  private cap() {
    // At most ~24 MB encoded, leaving room for the message log's 64 MB quota.
    while (this.archived.size > MAX_ARCHIVED) {
      const key = this.archived.keys().next().value!;
      this.archived.delete(key);
      this.remove(key);
    }
  }

  private remove(key: string) {
    this.enqueue(() => this.store.delete(`${PREFIX}${key}`));
  }

  private enqueue(write: () => Promise<boolean>) {
    this.writes = this.writes
      .then(write)
      .catch((error) => console.error('[slick] MessageLogger image storage failed:', error));
  }
}
