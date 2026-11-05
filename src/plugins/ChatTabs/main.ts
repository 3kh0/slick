import type { SlickMainPlugin } from '$slick';
import { isCloseTabInput } from './shortcut.ts';
import { id } from './meta.ts';

const shortcuts = new Map<Electron.WebContents, () => void>();

function remove(contents: Electron.WebContents) {
  shortcuts.get(contents)?.();
  shortcuts.delete(contents);
}

export default {
  id,
  capabilities: [],
  ready() {
    return () => {
      for (const contents of shortcuts.keys()) remove(contents);
    };
  },
  rpc: {
    closeShortcut(ctx, [enabled], contents) {
      if (enabled !== true || !contents.getURL().startsWith('https://app.slack.com/client/')) {
        remove(contents);
        return;
      }
      if (shortcuts.has(contents)) return;
      const onInput = (event: Electron.Event, input: Electron.Input) => {
        if (!isCloseTabInput(input)) return;
        event.preventDefault();
        if (!input.isAutoRepeat) ctx.emitTo(contents, 'close-tab');
      };
      const cleanup = () => {
        contents.removeListener('before-input-event', onInput);
        contents.removeListener('destroyed', destroyed);
        contents.removeListener('did-start-navigation', navigated);
      };
      const destroyed = () => remove(contents);
      const navigated = (_event: Electron.Event, _url: string, isInPlace: boolean, isMainFrame: boolean) => {
        if (isMainFrame && !isInPlace) remove(contents);
      };
      shortcuts.set(contents, cleanup);
      contents.on('before-input-event', onInput);
      contents.once('destroyed', destroyed);
      contents.on('did-start-navigation', navigated);
    },
  },
} satisfies SlickMainPlugin;
