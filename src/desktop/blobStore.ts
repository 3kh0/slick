// On-disk namespaced key/value store behind api.storage and ctx.storage.

import { promises as fs } from 'node:fs';
import path from 'node:path';
import { settingsDir } from './paths.js';

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
  const values = await Promise.all(keys.map((key) => read(namespace, key)));
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

export async function write(namespace: string, key: string, value: string): Promise<boolean> {
  if (typeof value !== 'string' || Buffer.byteLength(value) > MAX_VALUE_BYTES) return false;
  try {
    const file = keyPath(namespace, key);
    await fs.mkdir(path.dirname(file), { recursive: true });
    // Write-then-rename so a crash can't truncate existing data.
    const temp = `${file}.${process.pid}.tmp`;
    await fs.writeFile(temp, value, 'utf8');
    await fs.rename(temp, file);
    return true;
  } catch (error) {
    console.error(`[slick] storage write failed (${namespace}/${key}):`, error);
    return false;
  }
}

export async function remove(namespace: string, key: string): Promise<boolean> {
  try {
    await fs.rm(keyPath(namespace, key), { force: true });
    return true;
  } catch {
    return false;
  }
}

export async function clear(namespace: string): Promise<boolean> {
  try {
    await fs.rm(storeDir(namespace), { recursive: true, force: true });
    return true;
  } catch {
    return false;
  }
}
