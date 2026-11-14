export function isCloseTabInput(
  input: Pick<Electron.Input, 'type' | 'key' | 'meta' | 'control' | 'alt' | 'shift'>,
  platform = process.platform,
): boolean {
  return (
    input.type === 'keyDown' &&
    input.key.toLowerCase() === 'w' &&
    !input.alt &&
    !input.shift &&
    (platform === 'darwin' ? input.meta && !input.control : input.control && !input.meta)
  );
}
export const arrowShortcutHints: Record<string, [aria: string, title: string]> = {
  'alt-shift': [' Alt+Shift+ArrowLeft Alt+Shift+ArrowRight', ' or Alt+Shift+Left/Right'],
  'meta-alt': [' Meta+Alt+ArrowLeft Meta+Alt+ArrowRight', ' or Cmd+Option+Left/Right'],
  off: ['', ''],
};
export function tabSwitchDirection(
  input: Pick<KeyboardEvent, 'key' | 'ctrlKey' | 'altKey' | 'metaKey' | 'shiftKey'>,
  arrows: 'alt-shift' | 'meta-alt' | 'off' = 'alt-shift',
): number {
  if (input.ctrlKey && !input.altKey && !input.metaKey && input.key === 'Tab') return input.shiftKey ? -1 : 1;
  const arrowMods =
    arrows === 'meta-alt'
      ? input.metaKey && !input.shiftKey
      : arrows === 'alt-shift' && !input.metaKey && input.shiftKey;
  if (!input.ctrlKey && input.altKey && arrowMods) {
    if (input.key === 'ArrowLeft') return -1;
    if (input.key === 'ArrowRight') return 1;
  }
  return 0;
}
export function sidebarTabClick(
  input: Pick<MouseEvent, 'button' | 'ctrlKey' | 'altKey' | 'metaKey' | 'shiftKey'>,
  mac: boolean,
): 'background' | 'foreground' | undefined {
  if (input.altKey) return;
  const command = mac ? input.metaKey && !input.ctrlKey : input.ctrlKey && !input.metaKey;
  if (input.button !== 1 && !(input.button === 0 && command)) return;
  return input.shiftKey ? 'foreground' : 'background';
}
