import path from 'node:path';
import type { SlickMainPlugin } from '$slick';
import { app, nativeImage, nativeTheme, systemPreferences } from 'electron';
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
import prideInverted from './icons/pride-inverted.png';
import pride from './icons/pride.png';
import slickDark from './icons/slick-dark.png';
import { id } from './meta.ts';

type Theme = 'light' | 'dark';

const IMAGES: Record<string, Record<Theme, string>> = {
  inverted: { light: inverted, dark: inverted },
  pride: { light: pride, dark: prideInverted },
  'pride-inverted': { light: prideInverted, dark: prideInverted },
};
const CUSTOM_KEY = 'custom';
const CUSTOM_SIZE = 1024;
const PREVIEW_SIZE = 128;
const LINUX_SLACK_ICONS = [
  '/usr/share/pixmaps/slack.png',
  '/usr/share/icons/hicolor/512x512/apps/slack.png',
  '/usr/share/icons/hicolor/256x256/apps/slack.png',
];

let theme: Theme = 'light';
let current: Electron.NativeImage | null = null;
let custom: Electron.NativeImage | null = null;
let slackIcon: Electron.NativeImage | null = null;
const slackIcons = new Map<Theme, Promise<Electron.NativeImage | null>>();
let refresh: (() => void) | null = null;

// macOS 26 "Icon & widget style": RegularDark, ClearAutomatic, TintedLight and so on.
function iconTheme(): Theme {
  if (process.platform !== 'darwin') return 'light';
  const style = systemPreferences.getUserDefault('AppleIconAppearanceTheme', 'string') ?? '';
  if (style.endsWith('Dark')) return 'dark';
  if (style.endsWith('Automatic')) return nativeTheme.shouldUseDarkColors ? 'dark' : 'light';
  return 'light';
}

function builtIn(key: string, look: Theme): Electron.NativeImage | null {
  if (key === 'slack') return slackIcon;
  return Object.hasOwn(IMAGES, key) ? nativeImage.createFromDataURL(IMAGES[key][look]) : null;
}

// Read from the installed Slack, so Slick never ships Slack's logo. On macOS the bundle's
// thumbnail is the system rendering, which already follows the icon style.
async function loadSlackIcon(): Promise<Electron.NativeImage | null> {
  const resources = process.resourcesPath;
  const thumbnails =
    process.platform === 'darwin'
      ? [path.resolve(resources, '..', '..'), path.join(resources, 'electron.icns')]
      : process.platform === 'win32'
        ? [path.join(resources, '..', 'slack.exe')]
        : [];
  for (const file of thumbnails) {
    try {
      const image = await nativeImage.createThumbnailFromPath(file, { width: CUSTOM_SIZE, height: CUSTOM_SIZE });
      if (!image.isEmpty()) return image;
    } catch {}
  }
  if (process.platform !== 'linux') return null;
  for (const file of LINUX_SLACK_ICONS) {
    const image = nativeImage.createFromPath(file);
    if (!image.isEmpty()) return image;
  }
  return null;
}

function slackFor(look: Theme): Promise<Electron.NativeImage | null> {
  let icon = slackIcons.get(look);
  if (!icon) slackIcons.set(look, (icon = loadSlackIcon()));
  return icon;
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
    theme = iconTheme();
    slackIcon = await slackFor(theme);
    refresh = () => {
      const icon = String(ctx.settings.icon);
      const image = icon === 'custom' ? custom : builtIn(icon, theme);
      current = image ? platformIcon(image) : defaultAppIcon();
      applyAppIcon(current);
    };
    refresh();
    const unsubscribe = ctx.onSettingsChange(refresh);
    const onWindow = (_event: Electron.Event, window: Electron.BrowserWindow) => applyWindowIcon(window, current);
    // The icon style has no change event; appearance changes and returning to Slick cover switching it in Settings.
    const onTheme = () => {
      const next = iconTheme();
      if (next === theme) return;
      theme = next;
      void slackFor(next).then((image) => {
        if (theme !== next) return;
        slackIcon = image;
        refresh?.();
      });
    };
    app.on('browser-window-created', onWindow);
    app.on('browser-window-focus', onTheme);
    nativeTheme.on('updated', onTheme);
    return () => {
      app.off('browser-window-created', onWindow);
      app.off('browser-window-focus', onTheme);
      nativeTheme.off('updated', onTheme);
      unsubscribe();
      refresh = null;
      current = null;
      custom = null;
      applyAppIcon(defaultAppIcon());
    };
  },
  rpc: {
    async previews() {
      const look = iconTheme();
      const slackImage = await slackFor(look);
      return Object.fromEntries(
        ICONS.flatMap((icon) => {
          const image =
            icon.id === 'slick'
              ? look === 'dark'
                ? nativeImage.createFromDataURL(slickDark)
                : defaultIconPreview()
              : icon.id === 'slack'
                ? slackImage
                : builtIn(icon.id, look);
          return image ? [[icon.id, fitIcon(image, PREVIEW_SIZE).toDataURL()]] : [];
        }),
      );
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
