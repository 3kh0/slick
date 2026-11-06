// Where the floating call window sits on the Slack page. Pure, so the clamping
// is testable; the component only feeds it pointer deltas and viewport sizes.

export interface WindowRect {
  left: number;
  top: number;
  width: number;
  height: number;
}

export interface Viewport {
  width: number;
  height: number;
}

export const MIN_WINDOW_SIZE = { width: 320, height: 240 };
// Enough of the header stays on screen to grab it again.
const VISIBLE_MARGIN = 48;
const EDGE_GAP = 24;

/** Bottom-right, about a third of the page, like a picture-in-picture window. */
export function defaultWindowRect(viewport: Viewport): WindowRect {
  const width = Math.max(MIN_WINDOW_SIZE.width, Math.min(640, Math.round(viewport.width * 0.4)));
  const height = Math.max(MIN_WINDOW_SIZE.height, Math.min(480, Math.round(viewport.height * 0.5)));
  return clampWindowRect(
    { left: viewport.width - width - EDGE_GAP, top: viewport.height - height - EDGE_GAP, width, height },
    viewport,
  );
}

/** Keeps the window at least its minimum size, no bigger than the page, and grabbable. */
export function clampWindowRect(rect: WindowRect, viewport: Viewport): WindowRect {
  const width = Math.min(Math.max(rect.width, MIN_WINDOW_SIZE.width), Math.max(MIN_WINDOW_SIZE.width, viewport.width));
  const height = Math.min(
    Math.max(rect.height, MIN_WINDOW_SIZE.height),
    Math.max(MIN_WINDOW_SIZE.height, viewport.height),
  );
  const left = Math.min(Math.max(rect.left, VISIBLE_MARGIN - width), viewport.width - VISIBLE_MARGIN);
  const top = Math.min(Math.max(rect.top, 0), viewport.height - VISIBLE_MARGIN);
  return { left: Math.round(left), top: Math.round(top), width: Math.round(width), height: Math.round(height) };
}

export function moveWindowRect(rect: WindowRect, deltaX: number, deltaY: number, viewport: Viewport): WindowRect {
  return clampWindowRect({ ...rect, left: rect.left + deltaX, top: rect.top + deltaY }, viewport);
}

/** A side or corner of the window, as compass points ('n' = top edge, 'se' = bottom-right corner). */
export type ResizeEdge = 'n' | 's' | 'e' | 'w' | 'ne' | 'nw' | 'se' | 'sw';

export const RESIZE_EDGES: readonly ResizeEdge[] = ['n', 's', 'e', 'w', 'ne', 'nw', 'se', 'sw'];

const clamp = (value: number, low: number, high: number) => Math.min(Math.max(value, low), high);

/**
 * Drags one side or corner while the opposite side stays put. Sides stop at the
 * page edge (or where they already are, if the window hangs off it) and never
 * squeeze the window below its minimum size.
 */
export function resizeWindowFromEdge(
  rect: WindowRect,
  edge: ResizeEdge,
  deltaX: number,
  deltaY: number,
  viewport: Viewport,
): WindowRect {
  let left = rect.left;
  let top = rect.top;
  let right = rect.left + rect.width;
  let bottom = rect.top + rect.height;
  if (edge.includes('w')) left = clamp(left + deltaX, Math.min(0, rect.left), right - MIN_WINDOW_SIZE.width);
  if (edge.includes('e')) right = clamp(right + deltaX, left + MIN_WINDOW_SIZE.width, Math.max(viewport.width, right));
  if (edge.includes('n')) top = clamp(top + deltaY, Math.min(0, rect.top), bottom - MIN_WINDOW_SIZE.height);
  if (edge.includes('s'))
    bottom = clamp(bottom + deltaY, top + MIN_WINDOW_SIZE.height, Math.max(viewport.height, bottom));
  return clampWindowRect({ left, top, width: right - left, height: bottom - top }, viewport);
}

/** Reads a saved rect; anything malformed falls back to the default. */
export function parseWindowRect(saved: unknown, viewport: Viewport): WindowRect {
  const rect = saved as Partial<WindowRect> | null;
  const numeric =
    rect && ['left', 'top', 'width', 'height'].every((key) => Number.isFinite(rect[key as keyof WindowRect]));
  return numeric ? clampWindowRect(rect as WindowRect, viewport) : defaultWindowRect(viewport);
}
