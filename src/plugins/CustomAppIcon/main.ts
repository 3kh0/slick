import path from 'node:path';
import type { SlickMainPlugin } from '$slick';
import { app, nativeImage, nativeTheme, systemPreferences } from 'electron';
import { applyAppIcon, applyWindowIcon, defaultAppIcon, fitIcon, platformIcon } from '../../desktop/appIcon.ts';
import { ICONS, type ImportResult } from './icons.ts';
import darkFlat from './icons/dark-flat.png';
import dark from './icons/dark.png';
import light from './icons/light.png';
import prideDark from './icons/pride-dark.png';
import prideLight from './icons/pride-light.png';
import tileDark from './icons/tile-dark.png';
import { id } from './meta.ts';

type Theme = 'light' | 'dark';

// Each inverted design is the opposite of its partner, so all four stay distinct in either theme.
const IMAGES: Record<string, Record<Theme, string>> = {
  slick: { light, dark },
  inverted: { light: darkFlat, dark: light },
  pride: { light: prideLight, dark: prideDark },
  'pride-inverted': { light: prideDark, dark: prideLight },
};
const PARTNERS: Record<string, string> = {
  slick: 'inverted',
  inverted: 'slick',
  slack: 'slack-inverted',
  'slack-inverted': 'slack',
  pride: 'pride-inverted',
  'pride-inverted': 'pride',
};
// Auto mode ignores the icon style and uses each design's light look, so normal is a light tile and inverted a dark one.
const AUTO_BASE: Record<string, string> = {
  slick: light,
  inverted: darkFlat,
  pride: prideLight,
  'pride-inverted': prideDark,
};
const CUSTOM_KEY = 'custom';
const CUSTOM_SIZE = 1024;
const PREVIEW_SIZE = 128;
const LINUX_SLACK_ICONS = [
  '/usr/share/pixmaps/slack.png',
  '/usr/share/icons/hicolor/512x512/apps/slack.png',
  '/usr/share/icons/hicolor/256x256/apps/slack.png',
];

let current: Electron.NativeImage | null = null;
let custom: Electron.NativeImage | null = null;
const slackIcons = new Map<string, Promise<Electron.NativeImage | null>>();
let refresh: (() => void) | null = null;

// macOS 26 "Icon & widget style": RegularDark, ClearAutomatic, TintedLight and so on.
function systemTheme(): Theme {
  if (process.platform !== 'darwin') return 'light';
  const style = systemPreferences.getUserDefault('AppleIconAppearanceTheme', 'string') ?? '';
  if (style.endsWith('Dark')) return 'dark';
  if (style.endsWith('Automatic')) return nativeTheme.shouldUseDarkColors ? 'dark' : 'light';
  return 'light';
}

const themeFor = (appearance: unknown): Theme =>
  appearance === 'light' || appearance === 'dark' ? appearance : systemTheme();

async function thumbnail(file: string): Promise<Electron.NativeImage | null> {
  try {
    const image = await nativeImage.createThumbnailFromPath(file, { width: CUSTOM_SIZE, height: CUSTOM_SIZE });
    return image.isEmpty() ? null : image;
  } catch {
    return null;
  }
}

// Read from the installed Slack (process.resourcesPath is Slack's here), so Slick never ships Slack's logo.
async function slackLight(): Promise<Electron.NativeImage | null> {
  const resources = process.resourcesPath;
  if (process.platform === 'darwin') return thumbnail(path.join(resources, 'electron.icns'));
  if (process.platform === 'win32') return thumbnail(path.join(resources, '..', 'slack.exe'));
  for (const file of LINUX_SLACK_ICONS) {
    const image = nativeImage.createFromPath(file);
    if (!image.isEmpty()) return image;
  }
  return null;
}

// Lifts Slack's logo off its white tile onto Slick's dark one, for a dark Slack icon the system won't render.
function onDarkTile(logo: Electron.NativeImage): Electron.NativeImage {
  const base = nativeImage.createFromDataURL(tileDark);
  const { width, height } = base.getSize();
  const out = base.toBitmap();
  const src = logo.resize({ width, height, quality: 'best' }).toBitmap();
  const lo = Math.floor(width * 0.2);
  const hi = Math.ceil(width * 0.8);
  for (let y = lo; y < hi; y++) {
    for (let x = lo; x < hi; x++) {
      const i = (y * width + x) * 4;
      const ink = 1 - Math.min(src[i], src[i + 1], src[i + 2]) / 255;
      const m = (Math.min(1, Math.max(0, (ink - 0.12) * 2.6)) * src[i + 3]) / 255;
      for (let c = 0; c < 3; c++) out[i + c] = Math.round(out[i + c] * (1 - m) + src[i + c] * m);
    }
  }
  return nativeImage.createFromBitmap(out, { width, height });
}

async function slackDark(): Promise<Electron.NativeImage | null> {
  if (process.platform !== 'darwin') return slackFor('light');
  // The bundle's thumbnail is the system's own rendering, so it is only the dark one while macOS uses dark icons.
  if (systemTheme() === 'dark') {
    const native = await thumbnail(path.resolve(process.resourcesPath, '..', '..'));
    if (native) return native;
  }
  const lightIcon = await slackFor('light');
  return lightIcon && onDarkTile(lightIcon);
}

function slackFor(theme: Theme): Promise<Electron.NativeImage | null> {
  const key = theme === 'light' ? 'light' : `dark-${systemTheme()}`;
  let icon = slackIcons.get(key);
  if (!icon) slackIcons.set(key, (icon = theme === 'light' ? slackLight() : slackDark()));
  return icon;
}

function slackInvertedFor(theme: Theme): Promise<Electron.NativeImage | null> {
  if (theme === 'dark') return slackFor('light');
  let icon = slackIcons.get('inverted');
  if (!icon) {
    icon = slackFor('light').then((logo) => (logo ? onDarkTile(logo) : null));
    slackIcons.set('inverted', icon);
  }
  return icon;
}

function builtIn(key: string, theme: Theme): Electron.NativeImage | null {
  return Object.hasOwn(IMAGES, key) ? nativeImage.createFromDataURL(IMAGES[key][theme]) : null;
}

async function autoIcon(key: string): Promise<Electron.NativeImage | null> {
  const design = nativeTheme.shouldUseDarkColors ? PARTNERS[key] : key;
  if (design === 'slack') return slackFor('light');
  if (design === 'slack-inverted') return slackInvertedFor('light');
  return nativeImage.createFromDataURL(AUTO_BASE[design]);
}

async function iconFor(key: string, appearance: unknown, auto: unknown): Promise<Electron.NativeImage | null> {
  if (auto === true && Object.hasOwn(PARTNERS, key)) return autoIcon(key);
  const theme = themeFor(appearance);
  if (key === 'slack') return slackFor(theme);
  if (key === 'slack-inverted') return slackInvertedFor(theme);
  return builtIn(key, theme);
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
    let generation = 0;
    let shown = '';
    const describe = () => {
      const icon = String(ctx.settings.icon);
      const appearance = ctx.settings.appearance;
      const auto = ctx.settings.autoInvert === true;
      const theme = auto ? (nativeTheme.shouldUseDarkColors ? 'auto-dark' : 'auto-light') : themeFor(appearance);
      return { icon, appearance, auto, key: `${icon}:${theme}` };
    };
    refresh = () => {
      const { icon, appearance, auto, key } = describe();
      const run = ++generation;
      // The app's own icon already follows the system style, including Clear and Tinted.
      const pick =
        icon === 'custom'
          ? Promise.resolve(custom)
          : icon === 'slick' && appearance === 'system' && !auto
            ? Promise.resolve(null)
            : iconFor(icon, appearance, auto);
      void pick.then((image) => {
        if (run !== generation) return;
        shown = key;
        current = image ? platformIcon(image) : defaultAppIcon();
        applyAppIcon(current);
      });
    };
    refresh();
    const unsubscribe = ctx.onSettingsChange(() => refresh?.());
    const onWindow = (_event: Electron.Event, window: Electron.BrowserWindow) => applyWindowIcon(window, current);
    // The icon style has no change event; appearance changes and returning to Slick cover switching it in Settings.
    const onTheme = () => {
      if (describe().key !== shown) refresh?.();
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
    async previews(_ctx, [appearance, auto]) {
      const entries = await Promise.all(
        ICONS.map(async (icon) => {
          const image = await iconFor(icon.id, appearance, auto);
          return image ? [[icon.id, fitIcon(image, PREVIEW_SIZE).toDataURL()] as const] : [];
        }),
      );
      return Object.fromEntries(entries.flat());
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
