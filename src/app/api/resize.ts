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

function setHolding(next: boolean) {
  if (holding === next) return;
  holding = next;
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
