import fs from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export type TrayState = 'rest' | 'unread' | 'highlight';

const DEV_DIR = fileURLToPath(new URL('../../assets/tray', import.meta.url));

export function trayStateOf(bitmap: Uint8Array): TrayState {
  let opaque = 0;
  let colored = 0;
  let green = 0;
  for (let i = 0; i + 3 < bitmap.length; i += 4) {
    if (bitmap[i + 3] < 128) continue;
    opaque += 1;
    const a = bitmap[i];
    const g = bitmap[i + 1];
    const b = bitmap[i + 2];
    if (Math.max(a, g, b) - Math.min(a, g, b) <= 80) continue;
    colored += 1;
    green += g;
  }
  if (colored < Math.max(4, opaque * 0.05)) return 'rest';
  return green / colored > 120 ? 'unread' : 'highlight';
}

export function trayDir(slickResources: string): string | null {
  for (const dir of [path.join(slickResources, 'tray'), DEV_DIR]) {
    if (fs.existsSync(path.join(dir, 'rest.png'))) return dir;
  }
  return null;
}

export function wrapTray<T extends new (...args: any[]) => Electron.Tray>(OrigTray: T, dir: string | null): T {
  if (!dir) return OrigTray;
  const { nativeImage } = createRequire(import.meta.url)('electron') as typeof Electron;
  const cache = new Map<string, Electron.NativeImage>();
  const load = (file: string) => {
    let image = cache.get(file);
    if (!image) {
      image = nativeImage.createFromPath(path.join(dir, file));
      cache.set(file, image);
    }
    return image.isEmpty() ? null : image;
  };

  function replacement(image: Electron.NativeImage | string): Electron.NativeImage | string {
    try {
      const original = typeof image === 'string' ? nativeImage.createFromPath(image) : image;
      if (original.isEmpty()) return image;
      if (process.platform === 'darwin') {
        if (!original.isTemplateImage()) return image;
        const template = load('menubarTemplate.png');
        template?.setTemplateImage(true);
        return template ?? image;
      }
      const state = trayStateOf(original.toBitmap());
      return load(process.platform === 'win32' ? `${state}.ico` : `${state}.png`) ?? image;
    } catch (error) {
      console.error('[slick] tray icon swap failed:', error);
      return image;
    }
  }

  return new Proxy(OrigTray, {
    construct(Target, [image, ...rest]: any[]) {
      const tray = new Target(replacement(image), ...rest);
      const setImage = tray.setImage.bind(tray);
      tray.setImage = (next: Electron.NativeImage | string) => setImage(replacement(next));
      const displayBalloon = tray.displayBalloon?.bind(tray);
      if (displayBalloon) {
        tray.displayBalloon = (options: Electron.DisplayBalloonOptions) =>
          displayBalloon(options?.icon ? { ...options, icon: load('tile.png') ?? options.icon } : options);
      }
      return tray;
    },
  });
}
