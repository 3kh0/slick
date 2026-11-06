import { readFile } from 'node:fs/promises';

/** Coalesce simultaneous loads without blocking Electron's main event loop. */
export function createAssetReader(
  cacheCompleted: boolean,
  load: (file: string) => Promise<Uint8Array<ArrayBuffer>> = readFile,
) {
  const pending = new Map<string, Promise<Uint8Array<ArrayBuffer>>>();
  return (file: string): Promise<Uint8Array<ArrayBuffer>> => {
    const existing = pending.get(file);
    if (existing) return existing;
    const result = load(file).then(
      (bytes) => {
        if (!cacheCompleted) pending.delete(file);
        return bytes;
      },
      (error: unknown) => {
        pending.delete(file);
        throw error;
      },
    );
    pending.set(file, result);
    return result;
  };
}
