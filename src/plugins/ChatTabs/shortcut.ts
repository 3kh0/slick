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
