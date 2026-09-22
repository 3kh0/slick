// Plugin-scoped encrypted storage for credentials and other secrets.

import { promises as fs } from 'node:fs';
import path from 'node:path';
import { safeStorage } from 'electron';
import { settingsDir } from './paths.js';

const MAX_VALUE_BYTES = 8 * 1024 * 1024;

function safeSegment(value: string): string {
  const cleaned = value.replace(/[^A-Za-z0-9_.-]/g, '_');
  if (!cleaned || cleaned === '.' || cleaned === '..') throw new Error('[slick] invalid secret storage segment');
  return cleaned.slice(0, 200);
}

function keyPath(namespace: string, key: string): string {
  return path.join(settingsDir(), 'secrets', safeSegment(namespace), `${safeSegment(key)}.dat`);
}

export async function read(namespace: string, key: string): Promise<string | null> {
  try {
    const data = await fs.readFile(keyPath(namespace, key));
    return safeStorage.isEncryptionAvailable() ? safeStorage.decryptString(data) : data.toString('utf8');
  } catch {
    return null;
  }
}

export async function write(namespace: string, key: string, value: string): Promise<boolean> {
  if (typeof value !== 'string' || Buffer.byteLength(value) > MAX_VALUE_BYTES) return false;
  try {
    const file = keyPath(namespace, key);
    await fs.mkdir(path.dirname(file), { recursive: true, mode: 0o700 });
    const data = safeStorage.isEncryptionAvailable() ? safeStorage.encryptString(value) : Buffer.from(value, 'utf8');
    const temp = `${file}.${process.pid}.tmp`;
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
