// Plugin-scoped encrypted storage for credentials and other secrets.

import { randomUUID } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { safeStorage } from 'electron';
import { settingsDir } from './paths.js';

const MAX_VALUE_BYTES = 8 * 1024 * 1024;
// First byte of every file, so a keyring that comes or goes between launches
// can't make encrypted bytes read as plaintext (or the reverse).
const ENCRYPTED = 0x45; // 'E'
const PLAIN = 0x50; // 'P'

function safeSegment(value: string): string {
  const cleaned = value.replace(/[^A-Za-z0-9_.-]/g, '_');
  if (!cleaned || cleaned === '.' || cleaned === '..') throw new Error('[slick] invalid secret storage segment');
  return cleaned.slice(0, 200);
}

function keyPath(namespace: string, key: string): string {
  return path.join(settingsDir(), 'secrets', safeSegment(namespace), `${safeSegment(key)}.dat`);
}

export async function read(namespace: string, key: string): Promise<string | null> {
  let data: Buffer;
  try {
    data = await fs.readFile(keyPath(namespace, key));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw error;
  }
  const body = data.subarray(1);
  if (data[0] === PLAIN) return body.toString('utf8');
  if (data[0] !== ENCRYPTED) throw new Error(`[slick] unrecognised secret file (${namespace}/${key})`);
  if (!safeStorage.isEncryptionAvailable())
    throw new Error('[slick] secret is encrypted but the keyring is unavailable');
  return safeStorage.decryptString(body);
}

export async function write(namespace: string, key: string, value: string): Promise<boolean> {
  if (typeof value !== 'string' || Buffer.byteLength(value) > MAX_VALUE_BYTES) return false;
  try {
    const file = keyPath(namespace, key);
    await fs.mkdir(path.dirname(file), { recursive: true, mode: 0o700 });
    const data = safeStorage.isEncryptionAvailable()
      ? Buffer.concat([Buffer.of(ENCRYPTED), safeStorage.encryptString(value)])
      : Buffer.concat([Buffer.of(PLAIN), Buffer.from(value, 'utf8')]);
    const temp = `${file}.${randomUUID()}.tmp`;
    await fs.writeFile(temp, data, { mode: 0o600 });
    await fs.rename(temp, file);
    return true;
  } catch (error) {
    console.error(`[slick] secret storage write failed (${namespace}/${key}):`, error);
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
