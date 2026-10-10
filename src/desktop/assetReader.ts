import { readFile } from 'node:fs/promises';

/** Coalesce concurrent requests; only immutable packaged bundles stay resident. */
export function createAssetReader(cache = false, read: (file: string) => Promise<Buffer<ArrayBuffer>> = readFile) {
  const pending = new Map<string, Promise<Buffer<ArrayBuffer>>>();
  return (file: string): Promise<Buffer<ArrayBuffer>> => {
    const existing = pending.get(file);
    if (existing) return existing;
    const request = read(file).then(
      (bytes) => {
        if (!cache) pending.delete(file);
        return bytes;
      },
      (error) => {
        pending.delete(file);
        throw error;
      },
    );
    pending.set(file, request);
    return request;
  };
}
