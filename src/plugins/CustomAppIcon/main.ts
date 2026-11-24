import path from 'node:path';
import type { SlickMainPlugin } from '$slick';
import { app, nativeImage, nativeTheme, systemPreferences } from 'electron';
import { applyAppIcon, applyWindowIcon, defaultAppIcon, fitIcon, platformIcon } from '../../desktop/appIcon.ts';
import { ICONS, type ImportResult, type Theme } from './icons.ts';
import darkFlat from './icons/dark-flat.png';
import dark from './icons/dark.png';
import light from './icons/light.png';
import prideDark from './icons/pride-dark.png';
import prideLight from './icons/pride-light.png';
import tileDark from './icons/tile-dark.png';
import { id } from './meta.ts';

// Each inverted design is the opposite of its partner, so all four stay distinct in either theme.
const IMAGES: Record<string, Record<Theme, string>> = {
  slick: { light, dark },
  inverted: { light: darkFlat, dark: light },
  pride: { light: prideLight, dark: prideDark },
  'pride-inverted': { light: prideDark, dark: prideLight },
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

// Slack sets nativeTheme.themeSource to its own theme, so read the OS where it can be read.
function systemDark(): boolean {
  if (process.platform === 'darwin')
    return systemPreferences.getUserDefault('AppleInterfaceStyle', 'string') === 'Dark';
  if (process.platform === 'win32') return nativeTheme.shouldUseDarkColorsForSystemIntegratedUI;
  return nativeTheme.shouldUseDarkColors;
}

// macOS 26 "Icon & widget style": RegularDark, ClearAutomatic, TintedLight and so on.
function systemTheme(): Theme {
  if (process.platform === 'darwin') {
    const style = systemPreferences.getUserDefault('AppleIconAppearanceTheme', 'string') ?? '';
    if (style.endsWith('Dark')) return 'dark';
    if (!style.endsWith('Automatic')) return 'light';
  }
  return systemDark() ? 'dark' : 'light';
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

// macOS: lifts Slack's logo off its white tile onto Slick's dark one. Elsewhere Slack's icon is a bare logo, so center it.
function onDarkTile(logo: Electron.NativeImage): Electron.NativeImage {
  const base = nativeImage.createFromDataURL(tileDark);
  const { width, height } = base.getSize();
  const out = base.toBitmap();
  if (process.platform === 'darwin') {
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
  } else {
    const size = Math.round(width * 0.58);
    const offset = Math.round((width - size) / 2);
    const src = logo.resize({ width: size, height: size, quality: 'best' }).toBitmap();
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const si = (y * size + x) * 4;
        const di = ((y + offset) * width + x + offset) * 4;
        const m = src[si + 3] / 255;
        for (let c = 0; c < 3; c++) out[di + c] = Math.round(out[di + c] * (1 - m) + src[si + c] * m);
      }
    }
  }
  return nativeImage.createFromBitmap(out, { width, height });
}

function cached(key: string, load: () => Promise<Electron.NativeImage | null>): Promise<Electron.NativeImage | null> {
  let icon = slackIcons.get(key);
  if (!icon) slackIcons.set(key, (icon = load()));
  return icon;
}

const slackOnDarkTile = () =>
  cached('on-dark-tile', async () => {
    const logo = await cached('light', slackLight);
    return logo && onDarkTile(logo);
  });

// The bundle's thumbnail is the system's own rendering, so it is only the dark one while macOS uses dark icons.
function slackDark(): Promise<Electron.NativeImage | null> {
  if (process.platform !== 'darwin' || systemTheme() !== 'dark') return slackOnDarkTile();
  return cached('native-dark', async () => {
    const native = await thumbnail(path.resolve(process.resourcesPath, '..', '..'));
    return native ?? slackOnDarkTile();
  });
}

function iconFor(key: string, theme: Theme): Promise<Electron.NativeImage | null> {
  if (key === 'slack') return theme === 'light' ? cached('light', slackLight) : slackDark();
  if (key === 'slack-inverted') return theme === 'light' ? slackOnDarkTile() : cached('light', slackLight);
  return Promise.resolve(Object.hasOwn(IMAGES, key) ? nativeImage.createFromDataURL(IMAGES[key][theme]) : null);
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
    let lastTheme = systemTheme();
    const keyFor = () => `${String(ctx.settings.icon)}:${themeFor(ctx.settings.appearance)}`;
    refresh = () => {
      const icon = String(ctx.settings.icon);
      const appearance = ctx.settings.appearance;
      const theme = themeFor(appearance);
      const key = keyFor();
      const run = ++generation;
      // The app's own icon follows the macOS icon style, Clear and Tinted included; elsewhere it is the light design.
      const native = icon === 'slick' && (process.platform === 'darwin' ? appearance === 'system' : theme === 'light');
      const pick = icon === 'custom' ? Promise.resolve(custom) : native ? Promise.resolve(null) : iconFor(icon, theme);
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
    // The macOS icon style has no change event; returning to Slick picks up a switch made in System Settings.
    const onTheme = () => {
      const theme = systemTheme();
      if (theme !== lastTheme) ctx.emit('theme-changed', (lastTheme = theme));
      if (keyFor() !== shown) refresh?.();
    };
    // AppleInterfaceStyle can lag the notification slightly.
    let themeTimer: ReturnType<typeof setTimeout> | undefined;
    const onMacTheme = () => {
      onTheme();
      clearTimeout(themeTimer);
      themeTimer = setTimeout(onTheme, 100);
    };
    const macThemeSub =
      process.platform === 'darwin'
        ? systemPreferences.subscribeNotification('AppleInterfaceThemeChangedNotification', onMacTheme)
        : null;
    app.on('browser-window-created', onWindow);
    app.on('browser-window-focus', onTheme);
    nativeTheme.on('updated', onTheme);
    return () => {
      app.off('browser-window-created', onWindow);
      app.off('browser-window-focus', onTheme);
      nativeTheme.off('updated', onTheme);
      if (macThemeSub !== null) systemPreferences.unsubscribeNotification(macThemeSub);
      clearTimeout(themeTimer);
      unsubscribe();
      refresh = null;
      current = null;
      custom = null;
      applyAppIcon(defaultAppIcon());
    };
  },
  rpc: {
    theme() {
      return systemTheme();
    },
    async previews(_ctx, [appearance]) {
      const theme = themeFor(appearance);
      const entries = await Promise.all(
        ICONS.map(async (icon) => {
          const image = await iconFor(icon.id, theme);
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
