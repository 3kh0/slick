// Slack does heavy JS layout on every `resize`, which fires per frame during a
// window drag, so the window trails the cursor. Our listener registers before
// Slack's (all `window` listeners are at-target, run in registration order),
// so `stopImmediatePropagation` suppresses Slack's handlers; one synthetic
// `resize` is replayed after the drag stops. Inert with no registrations.
//
// The technique — the quiet period, the replay, and the flex-basis
// compensation in the Snappy plugin — is ported from Taut
// (github.com/jeremy46231/taut, MIT), which solved this first.

type Registration = {
  quietMs: number;
  onHoldChange?: (holding: boolean) => void;
};

const registrations = new Set<Registration>();

let timer: ReturnType<typeof setTimeout> | undefined;
/** Lets the replayed event through the gate. */
let replaying = false;
let holding = false;

const quietMs = () => Math.max(...[...registrations].map((registration) => registration.quietMs));

// Slack's ResizeObservers also fire per frame during a drag, so Slack gets a
// ResizeObserver whose callbacks wait out the same hold. The browser never
// re-sends a delivered notification, so the latest entry per target is kept
// and replayed when the hold ends.

type HeldObserver = {
  callback: ResizeObserverCallback;
  observer: ResizeObserver;
  entries: Map<Element, ResizeObserverEntry>;
};

const heldObservers = new Set<HeldObserver>();

function releaseObservers() {
  const pending = [...heldObservers];
  heldObservers.clear();
  for (const held of pending) {
    try {
      held.callback([...held.entries.values()], held.observer);
    } catch (error) {
      reportError(error);
    }
  }
}

function installResizeObserverHold() {
  const Native = window.ResizeObserver;
  if (typeof Native !== 'function') return;

  class SlickResizeObserver extends Native {
    constructor(callback: ResizeObserverCallback) {
      let held: HeldObserver | undefined;
      super((entries, observer) => {
        if (!holding) return callback(entries, observer);
        held ??= { callback, observer, entries: new Map() };
        for (const entry of entries) held.entries.set(entry.target, entry);
        heldObservers.add(held);
      });
      const disconnect = this.disconnect.bind(this);
      this.disconnect = () => {
        if (held) {
          heldObservers.delete(held);
          held.entries.clear();
        }
        disconnect();
      };
      const unobserve = this.unobserve.bind(this);
      this.unobserve = (target: Element) => {
        held?.entries.delete(target);
        unobserve(target);
      };
    }
  }
  Object.defineProperty(SlickResizeObserver, 'name', { value: 'ResizeObserver' });
  window.ResizeObserver = SlickResizeObserver;
}

function setHolding(next: boolean) {
  if (holding === next) return;
  holding = next;
  // After the flag flips, so a callback that resizes something observes live.
  if (!next) releaseObservers();
  for (const registration of registrations) {
    try {
      registration.onHoldChange?.(next);
    } catch (error) {
      console.error('[slick] resize hold listener threw:', error);
    }
  }
}

function flush() {
  timer = undefined;
  setHolding(false);
  replaying = true;
  try {
    window.dispatchEvent(new UIEvent('resize'));
  } finally {
    replaying = false;
  }
}

function gate(event: Event) {
  if (!registrations.size || replaying) return;
  setHolding(true);
  clearTimeout(timer);
  timer = setTimeout(flush, quietMs());
  event.stopImmediatePropagation();
}

/**
 * Must run synchronously from the entrypoint, before Slack's bundle:
 * `stopImmediatePropagation` only suppresses listeners added after this one.
 */
export function installResizeGate() {
  window.addEventListener('resize', gate, true);
  installResizeObserverHold();
}

/**
 * Hold Slack's resize handlers until the window has been still for `quietMs`.
 * `onHoldChange` brackets the hold, for drawing a cheap stand-in while Slack's
 * own layout is paused. Returns a disposer.
 */
export function deferResizeWork(options: { quietMs: number; onHoldChange?: (holding: boolean) => void }): () => void {
  const registration: Registration = {
    quietMs: options.quietMs,
    onHoldChange: options.onHoldChange,
  };
  registrations.add(registration);

  return () => {
    if (!registrations.delete(registration)) return;
    try {
      registration.onHoldChange?.(false);
    } catch (error) {
      console.error('[slick] resize hold listener threw:', error);
    }
    // Removing the last registration mid-drag would leave Slack's layout stale.
    if (registrations.size || !holding) return;
    clearTimeout(timer);
    flush();
  };
}
