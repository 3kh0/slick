import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export const macSoundsDirectory = () => path.join(os.homedir(), 'Library', 'Sounds');

/** Shared by packaging and the native notification bridge. */
export function macNotificationSoundName(source: string): string | null {
  if (!/^[a-z0-9_]+\.mp3$/i.test(source)) return null;
  return `slick-${source.slice(0, -4)}.caf`;
}

export function macNotificationOptions(
  options: Electron.NotificationConstructorOptions,
  resources: string,
  soundsDirectory = resources,
): Electron.NotificationConstructorOptions {
  // Slack uses "none" for muted sounds and for web playback. A named sound
  // that macOS cannot find otherwise falls back to the system alert sound.
  if (options.sound === 'none') return { ...options, silent: true };
  if (options.silent || !options.sound) return options;
  const sound = macNotificationSoundName(options.sound);
  if (!sound || !existsSync(path.join(resources, sound))) return options;
  // A previously unresolved bundle sound name can keep playing the default
  // alert even after that name is installed in Library/Sounds. Use a separate,
  // content-addressed name that is only requested after the file is staged.
  if (soundsDirectory !== resources) {
    try {
      const audio = readFileSync(path.join(resources, sound));
      const hash = createHash('sha256').update(audio).digest('hex');
      const installed = `slick-stock-${hash}.caf`;
      const target = path.join(soundsDirectory, installed);
      mkdirSync(soundsDirectory, { recursive: true });
      if (!existsSync(target)) writeFileSync(target, audio);
      return { ...options, sound: installed };
    } catch (error) {
      console.error('[slick] could not install notification sound:', error);
    }
  }
  return { ...options, sound };
}

export function wrapMacNotifications<T extends new (...args: any[]) => any>(
  Original: T,
  resources: string,
  soundsDirectory = macSoundsDirectory(),
): T {
  return new Proxy(Original, {
    construct(Target, [options = {}, ...args], newTarget) {
      return Reflect.construct(
        Target,
        [macNotificationOptions(options, resources, soundsDirectory), ...args],
        newTarget,
      );
    },
  });
}
