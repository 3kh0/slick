import type { SlickBridge } from '../app/bridge.ts';
import { serialQueue } from '../shared/queue.ts';

export function cssEditor(
  bridge: Pick<SlickBridge, 'readUserCss' | 'writeUserCss' | 'onUserCssChange'>,
  readResource: () => string | undefined,
) {
  let active: Window | null = null;
  return async () => {
    if (active && !active.closed) {
      active.focus();
      return true;
    }
    // Open synchronously from the Preferences button so popup blockers allow it.
    const view = window.open('', 'slick-custom-css', 'popup,width=900,height=650');
    if (!view) return false;
    active = view;
    view.document.open();
    view.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>Slick Custom CSS</title>
      <style>
        :root { color-scheme:light dark; font-family:system-ui,sans-serif; }
        html,body { width:100%;height:100%;margin:0;overflow:hidden; }
        body { display:flex;flex-direction:column;background:#fff; }
        #help { margin:0;padding:10px 14px;font-size:12px; }
        #editor { width:100%;flex:1;min-height:0; }
        #status { padding:6px 14px;font-size:12px;min-height:16px; }
        @media(prefers-color-scheme:dark) { body { background:#1e1e1e; } }
      </style></head><body>
      <p id="help">Write raw CSS here. To load a JSON theme file, use Import theme JSON in Slick Preferences → Appearance. Changes save automatically; Ctrl/Cmd+S saves immediately.</p>
      <div id="editor"></div><div id="status" role="status" aria-live="polite">Loading Monaco…</div>
      </body></html>`);
    view.document.close();
    const status = view.document.getElementById('status')!;
    try {
      const value = await bridge.readUserCss();
      if (view.closed) return false;
      const { loadMonaco } = await import('./monacoLoader.ts');
      const { createEditor } = await loadMonaco(view, readResource);
      if (view.closed) return false;
      const { editor, saveKey } = createEditor(view, value);
      const enqueue = serialQueue();
      const ownWrites = new Set<string>();
      let incoming = false;
      let timer: ReturnType<typeof setTimeout> | undefined;
      const save = () => {
        clearTimeout(timer);
        const css = editor.getValue();
        return enqueue(async () => {
          ownWrites.add(css);
          try {
            status.textContent = (await bridge.writeUserCss(css)) ? 'Saved' : 'Could not save CSS.';
          } catch {
            status.textContent = 'Could not save CSS.';
          } finally {
            ownWrites.delete(css);
          }
        });
      };
      editor.addCommand(saveKey, () => void save());
      const changes = editor.onDidChangeModelContent(() => {
        if (incoming) return;
        clearTimeout(timer);
        status.textContent = 'Saving…';
        timer = setTimeout(() => void save(), 300);
      });
      const unwatch = bridge.onUserCssChange((css) => {
        if (ownWrites.has(css) || css === editor.getValue()) return;
        incoming = true;
        editor.setValue(css);
        incoming = false;
      });
      view.addEventListener('beforeunload', () => void save(), { once: true });
      const opener = new AbortController();
      window.addEventListener('pagehide', () => view.close(), { once: true, signal: opener.signal });
      view.addEventListener(
        'pagehide',
        () => {
          opener.abort();
          clearTimeout(timer);
          unwatch();
          changes.dispose();
          editor.dispose();
          if (active === view) active = null;
        },
        { once: true },
      );
      status.textContent = 'Ready';
      editor.focus();
      return true;
    } catch (error) {
      console.error('[slick] CSS editor failed to load:', error);
      status.textContent =
        'Could not load the editor resource. Reinstall Slick, or install the offline userscript, then reload Slack.';
      return false;
    }
  };
}
