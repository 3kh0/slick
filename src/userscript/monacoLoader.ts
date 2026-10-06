import source from 'slick:monaco-source';
import type * as Monaco from './monaco.ts';

// An IIFE cannot code-split import(). Keep the offline editor as text so V8 parses and initializes Monaco only when the Preferences button is clicked. Slack permits blob scripts, but disallows eval. Run in the editor window so its DOM, workers and Monaco globals also disappear when that window closes.
export async function loadMonaco(view: Window): Promise<typeof Monaco> {
  const script = view.document.createElement('script');
  const url = URL.createObjectURL(new Blob([source], { type: 'text/javascript' }));
  script.src = url;
  let onClose = () => {};
  try {
    await new Promise<void>((resolve, reject) => {
      onClose = () => reject(new Error('Editor window closed while loading Monaco'));
      view.addEventListener('pagehide', onClose, { once: true });
      script.addEventListener('load', () => resolve(), { once: true });
      script.addEventListener('error', () => reject(new Error('Monaco script could not load')), { once: true });
      if (view.closed) onClose();
      else view.document.head.append(script);
    });
    const loaded = (view as any).slickMonacoBundle as typeof Monaco | undefined;
    if (!loaded?.createEditor) throw new Error('Monaco did not initialize');
    return loaded;
  } finally {
    view.removeEventListener('pagehide', onClose);
    script.remove();
    URL.revokeObjectURL(url);
  }
}
