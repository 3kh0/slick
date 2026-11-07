import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  fitGrid,
  stageSections,
  tileTextScale,
  PARTICIPANT_ASPECT_RATIO,
  type StageEntry,
  type TileRect,
} from '../../media/stageLayout.ts';

const photo = (userId: string): StageEntry => ({ kind: 'photo', key: `photo-${userId}`, userId });
const video = (tileId: number, userId: string, isContent = false): StageEntry => ({
  kind: 'video',
  key: `tile-${tileId}`,
  tile: { tileId, userId, isLocal: false, isContent },
  userId,
});

function assertPacked(rects: TileRect[], width: number, height: number) {
  for (const [index, rect] of rects.entries()) {
    assert.ok(rect.width > 0 && rect.height > 0);
    assert.ok(rect.x >= 0 && rect.y >= 0);
    assert.ok(rect.x + rect.width <= width && rect.y + rect.height <= height);
    for (const other of rects.slice(index + 1)) {
      assert.ok(
        rect.x + rect.width <= other.x ||
          other.x + other.width <= rect.x ||
          rect.y + rect.height <= other.y ||
          other.y + other.height <= rect.y,
        'tiles must not overlap',
      );
    }
  }
}

describe('stage tiling', () => {
  it('keeps a screen share separate from five participants when a camera turns on', () => {
    const share = video(1, 'A', true);
    const photos = ['A', 'B', 'C', 'D', 'SELF'].map(photo);
    const before = stageSections([share, ...photos], null);
    const after = stageSections([share, photos[0], video(2, 'B'), ...photos.slice(2)], null);
    assert.deepEqual(before.main, [share]);
    assert.deepEqual(after.main, [share]);
    assert.deepEqual(
      after.sidebar.map((entry) => entry.userId),
      before.sidebar.map((entry) => entry.userId),
    );
    assert.equal(after.sidebar.length, 5);
  });

  it('shows all shares in the main area until one is expanded', () => {
    const entries = [video(1, 'A', true), video(2, 'B', true), photo('A'), photo('B')];
    assert.deepEqual(stageSections(entries, null).main, entries.slice(0, 2));
    const expanded = stageSections(entries, 'tile-2');
    assert.deepEqual(expanded.main, [entries[1]]);
    assert.deepEqual(expanded.sidebar, [entries[0], ...entries.slice(2)]);
    assert.equal(stageSections(entries.slice(2), 'tile-2').expanded, undefined);
    assert.deepEqual(stageSections(entries.slice(2), 'tile-2').main, entries.slice(2));
  });

  it('keeps everyone in one grid when no one is sharing', () => {
    const entries = [photo('A'), video(1, 'B'), photo('SELF')];
    assert.deepEqual(stageSections(entries, null).main, entries);
    assert.deepEqual(stageSections(entries, null).sidebar, []);
  });

  it('fits mixed share shapes and participant counts without overlap across window sizes', () => {
    for (const [width, height] of [
      [1600, 900],
      [900, 700],
      [420, 650],
      [350, 200],
    ]) {
      for (const ratios of [
        [16 / 9],
        [16 / 9, 1.5],
        [0.6, 2, 1.5],
        ...[2, 5, 9, 25].map((count) => Array(count).fill(PARTICIPANT_ASPECT_RATIO)),
      ]) {
        const rects = fitGrid(ratios, width, height, 12);
        assert.equal(rects.length, ratios.length);
        assertPacked(rects, width, height);
      }
    }
  });

  it('uses equal square participant tiles and centers an incomplete final row', () => {
    const rects = fitGrid(Array(5).fill(PARTICIPANT_ASPECT_RATIO), 1600, 900, 12);
    assert.equal(new Set(rects.map((rect) => `${rect.width}x${rect.height}`)).size, 1);
    assert.equal(rects[0].width, rects[0].height);
    assert.equal(new Set(rects.map((rect) => rect.y)).size, 2);
    const lastRow = rects.filter((rect) => rect.y === rects.at(-1)!.y);
    assert.ok(Math.abs(lastRow[0].x - (1600 - lastRow.at(-1)!.x - lastRow.at(-1)!.width)) <= 1);
  });

  it('returns no tiles without usable space', () => {
    assert.deepEqual(fitGrid([], 100, 100, 12), []);
    assert.deepEqual(fitGrid([1], 0, 100, 12), []);
    assert.deepEqual(fitGrid([1], 100, 0, 12), []);
  });

  it('packs square photos with portrait and landscape cameras at their actual shapes', () => {
    const ratios = [1, 9 / 16, 1, 16 / 9, 1];
    const rects = fitGrid(ratios, 1600, 900, 12);
    assertPacked(rects, 1600, 900);
    for (const [index, rect] of rects.entries()) {
      assert.ok(Math.abs(rect.width - rect.height * ratios[index]) < 1);
    }
    assert.equal(new Set(rects.map((rect) => rect.height)).size, 1);
    assert.ok(rects[1].width < rects[0].width);
    assert.ok(rects[3].width > rects[0].width);
  });
});

describe('tileTextScale', () => {
  it('is full size for big tiles and shrinks with the smaller side', () => {
    assert.equal(tileTextScale(640, 360), 1);
    assert.equal(tileTextScale(280, 140), 0.5);
    assert.equal(tileTextScale(300, 210), 0.75);
  });

  it('never goes below half size, so names stay readable', () => {
    assert.equal(tileTextScale(40, 30), 0.5);
  });
});
