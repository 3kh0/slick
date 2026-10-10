// On-disk namespaced key/value store behind api.storage and ctx.storage.

import { promises as fs } from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { settingsDir } from './paths.ts';
import { mapConcurrent } from '../shared/concurrent.ts';
import { BATCH_KEYS, type BlobChange } from '../shared/blobBatch.ts';

const MAX_VALUE_BYTES = 8 * 1024 * 1024;

// Keys use `:`, which Windows forbids in file names. `%` never survives
// safeSegment, so `%3A` is an unambiguous, reversible stand-in. Windows only:
// existing stores elsewhere already use `:`.
const COLON = process.platform === 'win32' ? '%3A' : ':';

/** Namespaces and keys become path segments, so they must not escape the root. */
function safeSegment(value: string): string {
  const cleaned = value.replace(/[^A-Za-z0-9_.:-]/g, '_');
  if (!cleaned || cleaned === '.' || cleaned === '..') throw new Error('[slick] invalid storage segment');
  return cleaned.slice(0, 200).replaceAll(':', COLON);
}

function storeDir(namespace: string): string {
  return path.join(settingsDir(), 'storage', safeSegment(namespace));
}

function keyPath(namespace: string, key: string): string {
  return path.join(storeDir(namespace), `${safeSegment(key)}.json`);
}

export async function list(namespace: string): Promise<string[]> {
  try {
    const entries = await fs.readdir(storeDir(namespace));
    return entries
      .filter((name) => name.endsWith('.json'))
      .map((name) => name.slice(0, -'.json'.length).replaceAll(COLON, ':'));
  } catch {
    return [];
  }
}

/** One call instead of an IPC round trip per key (MessageLogger holds ~1000). */
export async function readAll(namespace: string, prefix = ''): Promise<Record<string, string>> {
  const keys = (await list(namespace)).filter((key) => key.startsWith(prefix));
  const out: Record<string, string> = {};
  const values = await mapConcurrent(keys, (key) => read(namespace, key));
  keys.forEach((key, index) => {
    const value = values[index];
    if (value !== null) out[key] = value;
  });
  return out;
}

export async function read(namespace: string, key: string): Promise<string | null> {
  try {
    return await fs.readFile(keyPath(namespace, key), 'utf8');
  } catch {
    return null;
  }
}

const queues = new Map<string, Promise<unknown>>();

function exclusive(namespace: string, work: () => Promise<boolean>): Promise<boolean> {
  const dir = storeDir(namespace);
  const task = (queues.get(dir) ?? Promise.resolve()).catch(() => {}).then(work);
  queues.set(dir, task);
  void task
    .finally(() => {
      if (queues.get(dir) === task) queues.delete(dir);
    })
    .catch(() => {});
  return task;
}

/** Per-entry atomic replacement, ordered per namespace; retries are idempotent. */
export async function mutate(namespace: string, changes: BlobChange[]): Promise<boolean> {
  if (!Array.isArray(changes) || changes.length > BATCH_KEYS) return false;
  try {
    const files = new Map<string, string | null>();
    for (const change of changes) {
      if (!Array.isArray(change) || change.length !== 2) return false;
      const [key, value] = change;
      if (
        typeof key !== 'string' ||
        (value !== null && (typeof value !== 'string' || Buffer.byteLength(value) > MAX_VALUE_BYTES))
      )
        return false;
      files.set(keyPath(namespace, key), value);
    }
    return await exclusive(namespace, async () => {
      try {
        if ([...files.values()].some((value) => value !== null))
          await fs.mkdir(storeDir(namespace), { recursive: true });
        const outcomes = await mapConcurrent([...files], async ([file, value]) => {
          if (value === null) {
            await fs.rm(file, { force: true });
            return true;
          }
          const temp = `${file}.${randomUUID()}.tmp`;
          try {
            await fs.writeFile(temp, value, 'utf8');
            await fs.rename(temp, file);
            return true;
          } catch (error) {
            await fs.rm(temp, { force: true }).catch(() => {});
            throw error;
          }
        });
        return outcomes.every(Boolean);
      } catch (error) {
        console.error(`[slick] storage batch failed (${namespace}):`, error);
        return false;
      }
    });
  } catch {
    return false;
  }
}

export function write(namespace: string, key: string, value: string): Promise<boolean> {
  return mutate(namespace, [[key, value]]);
}

export function remove(namespace: string, key: string): Promise<boolean> {
  return mutate(namespace, [[key, null]]);
}

export async function clear(namespace: string): Promise<boolean> {
  try {
    return await exclusive(namespace, async () => {
      await fs.rm(storeDir(namespace), { recursive: true, force: true });
      return true;
    });
  } catch {
    return false;
  }
}
