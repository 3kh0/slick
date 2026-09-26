import type { BlobStore } from './storage.ts';

const PREFIX = 'stored:';
const CHUNK = 180 * 1024;
export const MAX_STORED_FILE = 16 * 1024 * 1024;

type Meta = { type: string; size: number; chunks: number };

const metaKey = (setting: string) => `file:${setting}`;
const chunkKey = (setting: string, index: number) => `file:${setting}:${index}`;

export function isStoredFile(value: unknown): value is string {
  return typeof value === 'string' && value.startsWith(PREFIX);
}

export function fileLabel(value: unknown): string {
  const text = String(value ?? '');
  return isStoredFile(text) ? text.slice(text.indexOf(':', PREFIX.length) + 1) : text;
}

function toBase64(bytes: Uint8Array): string {
  let binary = '';
  for (let at = 0; at < bytes.length; at += 0x8000) binary += String.fromCharCode(...bytes.subarray(at, at + 0x8000));
  return btoa(binary);
}

function fromBase64(text: string): Uint8Array<ArrayBuffer> {
  const binary = atob(text);
  const bytes = new Uint8Array(binary.length);
  for (let at = 0; at < binary.length; at++) bytes[at] = binary.charCodeAt(at);
  return bytes;
}

export async function writeStoredFile(store: BlobStore, setting: string, file: Blob & { name: string }) {
  if (file.size > MAX_STORED_FILE) throw new Error(`${file.name} is over ${MAX_STORED_FILE / 1024 / 1024} MB`);
  const bytes = new Uint8Array(await file.arrayBuffer());
  const previous = await readMeta(store, setting);
  const chunks = Math.max(1, Math.ceil(bytes.length / CHUNK));
  for (let index = 0; index < chunks; index++) {
    const part = toBase64(bytes.subarray(index * CHUNK, (index + 1) * CHUNK));
    if (!(await store.write(chunkKey(setting, index), part))) throw new Error('could not store the file');
  }
  const meta: Meta = { type: file.type, size: bytes.length, chunks };
  if (!(await store.write(metaKey(setting), JSON.stringify(meta)))) throw new Error('could not store the file');
  for (let index = chunks; index < (previous?.chunks ?? 0); index++) await store.delete(chunkKey(setting, index));
  return `${PREFIX}${Date.now().toString(36)}:${file.name}`;
}

async function readMeta(store: BlobStore, setting: string): Promise<Meta | null> {
  try {
    const meta = JSON.parse((await store.read(metaKey(setting))) ?? 'null');
    return Number.isInteger(meta?.chunks) && typeof meta.type === 'string' ? meta : null;
  } catch {
    return null;
  }
}

export async function readStoredFile(store: BlobStore, setting: string): Promise<Blob | null> {
  const meta = await readMeta(store, setting);
  if (!meta) return null;
  const parts: Uint8Array<ArrayBuffer>[] = [];
  for (let index = 0; index < meta.chunks; index++) {
    const part = await store.read(chunkKey(setting, index));
    if (part === null) return null;
    parts.push(fromBase64(part));
  }
  return new Blob(parts, { type: meta.type });
}
