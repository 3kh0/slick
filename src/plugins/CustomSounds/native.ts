import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, rename, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';

const exec = promisify(execFile);
export const expandSoundPath = (value: string) => value.trim().replace(/^~(?=[/\\]|$)/, os.homedir());

export async function prepareNativeSound(
  source: string,
  directory: string,
  convert: (input: string, output: string) => Promise<void> = async (input, output) => {
    await exec('/usr/bin/afconvert', ['-f', 'caff', '-d', 'LEI16', input, output]);
  },
): Promise<string> {
  const audio = await readFile(expandSoundPath(source));
  const hash = createHash('sha256').update(audio).digest('hex');
  const name = `slick-custom-${hash}.caf`;
  const target = path.join(directory, name);
  if (existsSync(target)) return name;
  await mkdir(directory, { recursive: true });
  const temporary = await mkdtemp(path.join(directory, '.slick-custom-'));
  try {
    const input = path.join(temporary, `source${path.extname(source)}`);
    const output = path.join(temporary, 'sound.caf');
    await writeFile(input, audio);
    await convert(input, output);
    await rename(output, target);
    return name;
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
}

export function overrideNativeSound(options: Electron.NotificationConstructorOptions, sound: string | null): void {
  if (sound && options.sound && options.sound !== 'none' && !options.silent) options.sound = sound;
}
