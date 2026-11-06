import type { VideoTile } from './mediaSession.ts';

/**
 * What the huddle window shows: one tile per participant (their camera, or
 * their profile photo when it's off) plus a tile per screen share, laid out
 * at the biggest size that fits the window. Pure, so the layout is testable.
 */

export type StageEntry =
  | { kind: 'video'; key: string; tile: VideoTile; userId: string | null }
  | { kind: 'photo'; key: string; userId: string };

// Profile photos are square; video uses whatever shape the stream actually has.
export const PHOTO_ASPECT_RATIO = 1;
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

/** One slot on the stage: a single tile, or up to four people without video sharing one square slot. */
export type StageSlot =
  | { kind: 'single'; key: string; entry: StageEntry }
  | { kind: 'group'; key: string; entries: StageEntry[] };

export const PEOPLE_PER_GROUP = 4;

/**
 * With `compact` on and at least two people without video, those people are
 * packed four to a square slot (a 2×2 grid of small square tiles) after the
 * videos. A leftover few get a square of their own at the same small size,
 * never one big tile beside small ones. Otherwise every entry gets its own slot.
 */
export function buildStageSlots(entries: StageEntry[], compact: boolean): StageSlot[] {
  const singles = (list: StageEntry[]) => list.map((entry): StageSlot => ({ kind: 'single', key: entry.key, entry }));
  const videos = entries.filter((entry) => entry.kind === 'video');
  const photos = entries.filter((entry) => entry.kind === 'photo');
  if (!compact || photos.length < 2) return singles(entries);
  const groups: StageSlot[] = [];
  for (let start = 0; start < photos.length; start += PEOPLE_PER_GROUP) {
    const members = photos.slice(start, start + PEOPLE_PER_GROUP);
    // Keyed by the first person, so a group keeps its identity while others join or leave after them.
    groups.push({ kind: 'group', key: `group-${members[0].key}`, entries: members });
  }
  return [...singles(videos), ...groups];
}

/**
 * How much to shrink a tile's name pill and buttons: full size at 280px and up,
 * never below half size, so names stay readable in small tiles.
 */
export function tileTextScale(width: number, height: number): number {
  return Math.min(1, Math.max(0.5, Math.min(width, height) / 280));
}

/** Packs tiles of height `tileHeight` into rows left to right; returns the row count, or Infinity if a tile is too wide. */
function rowsNeeded(aspectRatios: number[], tileHeight: number, width: number, gap: number): number {
  let rows = 1;
  let rowWidth = 0;
  for (const ratio of aspectRatios) {
    const tileWidth = Math.floor(tileHeight * ratio);
    if (tileWidth > width) return Infinity;
    const widened = rowWidth === 0 ? tileWidth : rowWidth + gap + tileWidth;
    if (widened > width) {
      rows++;
      rowWidth = tileWidth;
    } else {
      rowWidth = widened;
    }
  }
  return rows;
}

/**
 * The tallest whole-pixel tile height at which every tile (each at its own
 * aspect ratio) fits in `width × height` when wrapped into rows like CSS
 * flex-wrap. Binary search, since bigger tiles can jump to more rows.
 */
export function fitTileHeight(aspectRatios: number[], width: number, height: number, gap: number): number {
  if (aspectRatios.length === 0 || width <= 0 || height <= 0) return 0;
  const fits = (tileHeight: number) => {
    const rows = rowsNeeded(aspectRatios, tileHeight, width, gap);
    return rows * tileHeight + (rows - 1) * gap <= height;
  };
  let largestFitting = 0;
  let smallestTooBig = Math.floor(height) + 1;
  while (smallestTooBig - largestFitting > 1) {
    const candidate = Math.floor((largestFitting + smallestTooBig) / 2);
    if (fits(candidate)) largestFitting = candidate;
    else smallestTooBig = candidate;
  }
  return largestFitting;
}

/** "Sofia Egan (they/them)", or just the name when no pronouns are set. */
export function nameWithPronouns(name: string, pronouns: string | undefined): { name: string; pronouns: string } {
  const trimmed = pronouns?.trim() ?? '';
  return { name, pronouns: trimmed ? `(${trimmed})` : '' };
}
