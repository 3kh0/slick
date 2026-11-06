export function popupOptions(
  { url, frameName, features }: Pick<Electron.HandlerDetails, 'url' | 'frameName' | 'features'>,
  platform: NodeJS.Platform,
): Electron.BrowserWindowConstructorOptions {
  if (platform !== 'darwin' || url !== 'about:blank' || !frameName.startsWith('slick-')) return {};
  if (!/(?:^|,)\s*slick-titlebar\s*=\s*inline\s*(?:,|$)/i.test(features)) return {};
  return { titleBarStyle: 'hiddenInset', trafficLightPosition: { x: 14, y: 14 } };
}
