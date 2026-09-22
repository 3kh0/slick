// Window resize gating.
//
// Slack recomputes a lot of layout from JavaScript on every `resize` event —
// the top nav measures itself, virtualised lists re-run their sizing — and the
// compositor delivers one such event per frame while a window edge is dragged.
// Dragging a window across the screen therefore queues hundreds of layout
// passes, and the window visibly trails the cursor.
//
// Slick runs before Slack's first script, so its `resize` listener is
// registered first. For an event dispatched at `window` every listener is an
// at-target listener and they run in registration order, so being first is
// what makes `stopImmediatePropagation` able to suppress Slack's handlers
// entirely. One synthetic `resize` is dispatched once the drag stops and Slack
// catches up in a single pass.
//
// The gate is inert until something registers: with no registrations the event
// passes straight through, so turning the feature off restores stock behaviour
// rather than approximating it.
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
/** Set while the replayed event is in flight, so the gate lets its own event by. */
let replaying = false;
let holding = false;

/** The most patient registration wins; nobody gets resumed early. */
const quietMs = () => Math.max(...[...registrations].map((registration) => registration.quietMs));

// ResizeObserver
//
// The `resize` gate leaves Slack's ResizeObservers running, and those fire per
// frame during a drag too -- virtualised lists re-measuring rows, the composer
// re-fitting. Slick runs first, so it can hand Slack a ResizeObserver whose
// callbacks wait out the same hold. The browser counts a notification as
// delivered once it fires, so a held one is never re-sent: each observer's
// latest entry per target is kept and replayed when the hold ends.

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
      // Slack's callback, not ours; surface it as the browser would.
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
      // Anything still queued when Slack disconnects is no longer wanted.
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
 * Must be called synchronously from the app entrypoint, before Slack's bundle
 * runs. Installed later it would register after Slack's own listeners, and
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
    // Removing the last registration mid-drag would otherwise leave Slack
    // holding a stale layout until the next resize; let it catch up now.
    if (registrations.size || !holding) return;
    clearTimeout(timer);
    flush();
  };
}
