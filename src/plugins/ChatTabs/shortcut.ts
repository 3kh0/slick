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
export function tabSwitchDirection(
  input: Pick<KeyboardEvent, 'key' | 'ctrlKey' | 'altKey' | 'metaKey' | 'shiftKey'>,
): number {
  if (input.metaKey) return 0;
  if (input.ctrlKey && !input.altKey && input.key === 'Tab') return input.shiftKey ? -1 : 1;
  if (!input.ctrlKey && input.altKey && input.shiftKey) {
    if (input.key === 'ArrowLeft') return -1;
    if (input.key === 'ArrowRight') return 1;
  }
  return 0;
}
