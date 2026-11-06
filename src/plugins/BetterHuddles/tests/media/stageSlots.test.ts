import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { buildStageSlots, tileTextScale, type StageEntry } from '../../media/stageLayout.ts';

const photo = (userId: string): StageEntry => ({ kind: 'photo', key: `photo-${userId}`, userId });
const video = (tileId: number, userId: string): StageEntry => ({
  kind: 'video',
  key: `tile-${tileId}`,
  tile: { tileId, userId, isLocal: false, isContent: false },
  userId,
});
const shape = (slots: ReturnType<typeof buildStageSlots>) =>
  slots.map((slot) => (slot.kind === 'single' ? slot.entry.key : slot.entries.map((entry) => entry.key)));

describe('buildStageSlots', () => {
  it('packs people without video four to a slot, after the videos', () => {
    const entries = [photo('A'), video(1, 'B'), photo('C'), photo('D'), photo('E'), photo('F'), photo('G')];
    assert.deepEqual(shape(buildStageSlots(entries, true)), [
      'tile-1',
      ['photo-A', 'photo-C', 'photo-D', 'photo-E'],
      ['photo-F', 'photo-G'],
    ]);
  });

  it('starts at two people without video, with or without anyone on video', () => {
    assert.deepEqual(shape(buildStageSlots([photo('A'), photo('B')], true)), [['photo-A', 'photo-B']]);
    assert.deepEqual(shape(buildStageSlots([video(1, 'B'), photo('A')], true)), ['tile-1', 'photo-A']);
  });

  it('five people: a full square of four plus a square with the fifth at the same small size', () => {
    const entries = ['A', 'B', 'C', 'D', 'E'].map(photo);
    assert.deepEqual(shape(buildStageSlots(entries, true)), [
      ['photo-A', 'photo-B', 'photo-C', 'photo-D'],
      ['photo-E'],
    ]);
  });

  it('leaves the order alone with the setting off', () => {
    const entries = [photo('A'), video(1, 'B'), photo('C')];
    assert.deepEqual(shape(buildStageSlots(entries, false)), ['photo-A', 'tile-1', 'photo-C']);
  });

  it("keys a group by its first person, so it isn't remounted when someone later in it leaves", () => {
    const before = buildStageSlots([video(1, 'B'), photo('A'), photo('C'), photo('D')], true);
    const after = buildStageSlots([video(1, 'B'), photo('A'), photo('C')], true);
    assert.equal(before[1].key, after[1].key);
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
