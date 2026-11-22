import type { SlickMainPlugin } from '$slick';
import { app, nativeImage } from 'electron';
import {
  applyAppIcon,
  applyWindowIcon,
  defaultAppIcon,
  defaultIconPreview,
  fitIcon,
  platformIcon,
} from '../../desktop/appIcon.ts';
import { ICONS, type ImportResult } from './icons.ts';
import inverted from './icons/inverted.png';
import molten from './icons/molten.png';
import prideInverted from './icons/pride-inverted.png';
import pride from './icons/pride.png';
import { id } from './meta.ts';

const IMAGES: Record<string, string> = { inverted, pride, 'pride-inverted': prideInverted, molten };
const CUSTOM_KEY = 'custom';
const CUSTOM_SIZE = 1024;
const PREVIEW_SIZE = 128;

let current: Electron.NativeImage | null = null;
let custom: Electron.NativeImage | null = null;
let builtInPreviews: Record<string, string> | null = null;
let refresh: (() => void) | null = null;

function builtIn(key: string): Electron.NativeImage | null {
  return Object.hasOwn(IMAGES, key) ? nativeImage.createFromDataURL(IMAGES[key]) : null;
}

function decode(dataUrl: string | null): Electron.NativeImage | null {
  const image = dataUrl ? nativeImage.createFromDataURL(dataUrl) : null;
  return image && !image.isEmpty() ? image : null;
}

export default {
  id,
  capabilities: ['dialog'],
  async ready(ctx) {
    custom = decode(await ctx.storage.read(CUSTOM_KEY));
    refresh = () => {
      const icon = String(ctx.settings.icon);
      const image = icon === 'custom' ? custom : builtIn(icon);
      current = image ? platformIcon(image) : defaultAppIcon();
      applyAppIcon(current);
    };
    refresh();
    const unsubscribe = ctx.onSettingsChange(refresh);
    const onWindow = (_event: Electron.Event, window: Electron.BrowserWindow) => applyWindowIcon(window, current);
    app.on('browser-window-created', onWindow);
    return () => {
      app.off('browser-window-created', onWindow);
      unsubscribe();
      refresh = null;
      current = null;
      custom = null;
      applyAppIcon(defaultAppIcon());
    };
  },
  rpc: {
    previews() {
      builtInPreviews ??= Object.fromEntries(
        ICONS.map((icon) => [icon.id, fitIcon(builtIn(icon.id) ?? defaultIconPreview(), PREVIEW_SIZE).toDataURL()]),
      );
      return builtInPreviews;
    },
    customPreview() {
      return custom && fitIcon(custom, PREVIEW_SIZE).toDataURL();
    },
    // The image is re-encoded into plugin storage, so it survives the original moving and loses any metadata.
    async importCustom(ctx): Promise<ImportResult> {
      const file = await ctx.dialog.openFile({
        title: 'Choose an app icon',
        filters: [{ name: 'Images', extensions: ['png', 'jpg', 'jpeg'] }],
      });
      if (!file) return 'cancelled';
      const image = nativeImage.createFromPath(file);
      if (image.isEmpty()) return 'unreadable';
      const stored = fitIcon(image, CUSTOM_SIZE);
      if (!(await ctx.storage.write(CUSTOM_KEY, stored.toDataURL()))) return 'failed';
      custom = stored;
      refresh?.();
      return 'saved';
    },
    async removeCustom(ctx) {
      if (!(await ctx.storage.delete(CUSTOM_KEY))) return false;
      custom = null;
      refresh?.();
      return true;
    },
  },
} satisfies SlickMainPlugin;
