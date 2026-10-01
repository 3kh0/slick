import { existsSync } from 'node:fs';
import path from 'node:path';

/** Shared by packaging and the native notification bridge. */
export function macNotificationSoundName(source: string): string | null {
  if (!/^[a-z0-9_]+\.mp3$/i.test(source)) return null;
  return `slick-${source.slice(0, -4)}.caf`;
}

export function macNotificationOptions(
  options: Electron.NotificationConstructorOptions,
  resources: string,
): Electron.NotificationConstructorOptions {
  // Slack uses "none" for muted sounds and for web playback. A named sound
  // that macOS cannot find otherwise falls back to the system alert sound.
  if (options.sound === 'none') return { ...options, silent: true };
  if (options.silent || !options.sound) return options;
  const sound = macNotificationSoundName(options.sound);
  if (!sound || !existsSync(path.join(resources, sound))) return options;
  return { ...options, sound };
}

export function wrapMacNotifications<T extends new (...args: any[]) => any>(Original: T, resources: string): T {
  return new Proxy(Original, {
    construct(Target, [options = {}, ...args], newTarget) {
      return Reflect.construct(Target, [macNotificationOptions(options, resources), ...args], newTarget);
    },
  });
}
