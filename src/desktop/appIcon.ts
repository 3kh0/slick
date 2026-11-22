import { app, BrowserWindow, nativeImage } from 'electron';
import tile from '../../assets/desktop-dev.png';
import glyph from '../../assets/desktop-linux/512.png';

// X11 copies the icon's raw pixels into every window, and Windows tops out at 256px.
const WINDOW_ICON_SIZE = 256;

let defaultIcon: Electron.NativeImage | null | undefined;

export function fitIcon(image: Electron.NativeImage, size: number): Electron.NativeImage {
  const { width, height } = image.getSize();
  if (Math.max(width, height) <= size) return image;
  return image.resize(width >= height ? { width: size, quality: 'best' } : { height: size, quality: 'best' });
}

export function platformIcon(image: Electron.NativeImage): Electron.NativeImage {
  return process.platform === 'darwin' ? image : fitIcon(image, WINDOW_ICON_SIZE);
}

// Packaged macOS builds draw the bundle's Assets.car icon, which nativeImage can't load; null hands the dock back to it.
export function defaultAppIcon(): Electron.NativeImage | null {
  if (defaultIcon !== undefined) return defaultIcon;
  if (process.platform !== 'darwin') defaultIcon = platformIcon(nativeImage.createFromDataURL(glyph));
  else defaultIcon = app.isPackaged ? null : nativeImage.createFromDataURL(tile);
  return defaultIcon;
}

export function applyAppIcon(image: Electron.NativeImage | null): void {
  if (process.platform === 'darwin') app.dock?.setIcon(image as Electron.NativeImage);
  else for (const window of BrowserWindow.getAllWindows()) applyWindowIcon(window, image);
}

export function applyWindowIcon(window: Electron.BrowserWindow, image: Electron.NativeImage | null): void {
  if (image && process.platform !== 'darwin' && !window.isDestroyed()) window.setIcon(image);
}
