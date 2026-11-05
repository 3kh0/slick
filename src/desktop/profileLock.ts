import fs from 'node:fs';
import path from 'node:path';

export function clearStaleProfileLock(dir: string): void {
  let owner: string;
  try {
    owner = fs.readlinkSync(path.join(dir, 'SingletonLock'));
  } catch {
    return;
  }
  const match = /-(\d+)$/.exec(owner);
  const pid = Number(match?.[1]);
  if (!Number.isSafeInteger(pid) || pid <= 0) return;
  try {
    process.kill(pid, 0);
    return;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ESRCH') return;
  }
  for (const name of ['SingletonLock', 'SingletonCookie', 'SingletonSocket']) {
    const file = path.join(dir, name);
    try {
      if (fs.lstatSync(file).isSymbolicLink()) fs.unlinkSync(file);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
  }
  console.log('[slick] cleared a stale profile lock');
}
