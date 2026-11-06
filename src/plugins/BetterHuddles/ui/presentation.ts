import { CALL_WINDOW_CSS } from './styles.ts';

type Surface = Pick<Window, 'document' | 'close' | 'focus' | 'addEventListener' | 'removeEventListener'>;

export function createCallPresentation({
  document,
  open,
  mount,
  onClose,
  onBlocked,
}: {
  document: Document;
  open: () => Surface | null;
  mount: (document: Document, detached: boolean) => () => void;
  onClose: () => void;
  onBlocked: () => void;
}) {
  let popup: Surface | null = null;
  let unmount: (() => void) | null = null;
  let detached = false;

  function closed() {
    popup?.removeEventListener('pagehide', closed);
    popup = null;
    unmount?.();
    unmount = null;
    detached = false;
    onClose();
  }

  function dispose() {
    unmount?.();
    unmount = null;
    const previous = popup;
    popup = null;
    previous?.removeEventListener('pagehide', closed);
    previous?.close();
    detached = false;
  }

  function show(separate: boolean) {
    if (unmount && separate === detached) {
      popup?.focus();
      return;
    }
    const next = separate ? open() : null;
    dispose();
    popup = next;
    detached = Boolean(popup);
    if (separate && !popup) onBlocked();
    popup?.addEventListener('pagehide', closed);
    unmount = mount(popup?.document ?? document, detached);
    popup?.focus();
  }

  return { show, dispose };
}

export function prepareCallDocument(source: Document, target: Document): () => void {
  target.title = 'Huddle — Slick';
  for (const sheet of source.querySelectorAll('link[rel="stylesheet"]')) target.head.appendChild(sheet.cloneNode(true));
  const base = target.createElement('style');
  base.textContent =
    CALL_WINDOW_CSS +
    '\nhtml,body{margin:0;width:100%;height:100%;overflow:hidden}body{background:var(--dt_color-base-pry,#1a1d21);color:var(--dt_color-content-pry,#fff)}';
  target.head.appendChild(base);

  let frame = 0;
  const view = source.defaultView!;
  const sync = () => {
    frame = 0;
    const styles = view.getComputedStyle(source.body);
    for (let index = 0; index < styles.length; index++) {
      const name = styles[index];
      if (name.startsWith('--dt_color-') || name.startsWith('--sk_'))
        target.body.style.setProperty(name, styles.getPropertyValue(name), 'important');
    }
    target.body.classList.toggle('sk-client-theme--dark', source.body.classList.contains('sk-client-theme--dark'));
    target.body.classList.toggle('sk-client-theme--light', source.body.classList.contains('sk-client-theme--light'));
  };
  const schedule = () => {
    if (!frame) frame = view.requestAnimationFrame(sync);
  };
  const observer = new MutationObserver(schedule);
  observer.observe(source.body, { attributes: true, attributeFilter: ['class', 'style'] });
  observer.observe(source.head, { childList: true, characterData: true, subtree: true });
  sync();
  return () => {
    observer.disconnect();
    if (frame) view.cancelAnimationFrame(frame);
  };
}
