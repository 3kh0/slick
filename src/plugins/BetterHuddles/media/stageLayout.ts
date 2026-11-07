import type { VideoTile } from './mediaSession.ts';

/**
 * What the huddle window shows: one tile per participant (their camera, or
 * their profile photo when it's off) plus a tile per screen share, laid out
 * at the biggest size that fits the window. Pure, so the layout is testable.
 */

export type StageEntry =
  | { kind: 'video'; key: string; tile: VideoTile; userId: string | null }
  | { kind: 'photo'; key: string; userId: string };

export const DEFAULT_VIDEO_ASPECT_RATIO = 16 / 9;

/**
 * Screen shares first, then each participant (camera if on, else photo), then
 * any camera Chime couldn't match to a participant so no video is ever dropped.
 */
export function buildStageEntries(tiles: VideoTile[], participantIds: string[], localUserId: string): StageEntry[] {
  const people =
    participantIds.includes(localUserId) || !localUserId ? [...participantIds] : [...participantIds, localUserId];
  const cameras = tiles.filter((tile) => !tile.isContent);
  const shares: StageEntry[] = tiles
    .filter((tile) => tile.isContent)
    .map((tile) => ({ kind: 'video', key: `tile-${tile.tileId}`, tile, userId: tile.userId }));
  const placed = new Set<number>();
  const participants = people.map((userId): StageEntry => {
    const camera = cameras.find((tile) => tile.userId === userId && !placed.has(tile.tileId));
    if (!camera) return { kind: 'photo', key: `photo-${userId}`, userId };
    placed.add(camera.tileId);
    return { kind: 'video', key: `tile-${camera.tileId}`, tile: camera, userId };
  });
  const unmatched: StageEntry[] = cameras
    .filter((tile) => !placed.has(tile.tileId))
    .map((tile) => ({ kind: 'video', key: `tile-${tile.tileId}`, tile, userId: tile.userId }));
  return [...shares, ...participants, ...unmatched];
}

export const PARTICIPANT_ASPECT_RATIO = 1;

export interface TileRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export function fitGrid(aspectRatios: number[], width: number, height: number, gap: number): TileRect[] {
  if (!aspectRatios.length || width <= 0 || height <= 0) return [];
  function pack(tileHeight: number) {
    const widths = aspectRatios.map((ratio) => Math.floor(tileHeight * ratio));
    const plans = [{ rows: 0, cost: 0, start: 0 }];
    for (let end = 1; end <= widths.length; end++) {
      let rowWidth = 0;
      let best = { rows: Infinity, cost: Infinity, start: 0 };
      for (let start = end - 1; start >= 0; start--) {
        rowWidth += widths[start] + (start === end - 1 ? 0 : gap);
        if (rowWidth > width) break;
        const rows = plans[start].rows + 1;
        const cost = plans[start].cost + (width - rowWidth) ** 2;
        if (rows < best.rows || (rows === best.rows && cost < best.cost)) best = { rows, cost, start };
      }
      plans.push(best);
    }
    return { widths, plans, rows: plans.at(-1)!.rows };
  }
  let low = 0;
  let high = Math.floor(height) + 1;
  while (high - low > 1) {
    const candidate = Math.floor((low + high) / 2);
    const { rows } = pack(candidate);
    if (rows * candidate + (rows - 1) * gap <= height) low = candidate;
    else high = candidate;
  }
  if (!low) return [];
  const { widths, plans, rows } = pack(low);
  const rects: TileRect[] = Array(aspectRatios.length);
  let end = widths.length;
  for (let row = rows - 1; row >= 0; row--) {
    const start = plans[end].start;
    const rowWidth = widths.slice(start, end).reduce((sum, value) => sum + value, 0) + (end - start - 1) * gap;
    let x = Math.floor((width - rowWidth) / 2);
    const y = Math.floor((height - (rows * low + (rows - 1) * gap)) / 2 + row * (low + gap));
    for (let index = start; index < end; index++) {
      rects[index] = { x, y, width: widths[index], height: low };
      x += widths[index] + gap;
    }
    end = start;
  }
  return rects;
}

export function stageSections(entries: StageEntry[], expandedKey: string | null) {
  const shares = entries.filter((entry) => entry.kind === 'video' && entry.tile.isContent);
  const expanded = shares.find((entry) => entry.key === expandedKey);
  return {
    expanded,
    main: expanded ? [expanded] : shares.length ? shares : entries,
    sidebar: shares.length
      ? entries.filter((entry) => (expanded ? entry.key !== expanded.key : !shares.includes(entry)))
      : [],
  };
}

/**
 * How much to shrink a tile's name pill and buttons: full size at 280px and up,
 * never below half size, so names stay readable in small tiles.
 */
export function tileTextScale(width: number, height: number): number {
  return Math.min(1, Math.max(0.5, Math.min(width, height) / 280));
}

/** "Sofia Egan (they/them)", or just the name when no pronouns are set. */
export function nameWithPronouns(name: string, pronouns: string | undefined): { name: string; pronouns: string } {
  const trimmed = pronouns?.trim() ?? '';
  return { name, pronouns: trimmed ? `(${trimmed})` : '' };
}
