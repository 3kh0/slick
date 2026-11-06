import { describe, it } from 'node:test';
import { expect } from '../expect.ts';
import { buildStageEntries, fitTileHeight, nameWithPronouns } from '../../media/stageLayout.ts';

const camera = (tileId: number, userId: string | null, isLocal = false) => ({
  tileId,
  userId,
  isLocal,
  isContent: false,
});
const share = (tileId: number, userId: string) => ({ tileId, userId, isLocal: false, isContent: true });

describe('buildStageEntries', () => {
  it('shows a photo for everyone with their camera off, and video for those with it on', () => {
    const entries = buildStageEntries([camera(3, 'U2')], ['U1', 'U2', 'U3'], 'U1');
    expect(entries.map((entry) => [entry.kind, entry.userId])).toEqual([
      ['photo', 'U1'],
      ['video', 'U2'],
      ['photo', 'U3'],
    ]);
  });

  it('puts screen shares first and still shows the sharer as a person', () => {
    const entries = buildStageEntries([camera(3, 'U2'), share(7, 'U2')], ['U2'], 'U1');
    expect(entries.map((entry) => entry.key)).toEqual(['tile-7', 'tile-3', 'photo-U1']);
  });

  it('adds you even before Slack lists you as a participant', () => {
    expect(buildStageEntries([], ['U2'], 'U1').map((entry) => entry.userId)).toEqual(['U2', 'U1']);
  });

  it("never drops a camera Chime couldn't match to a participant", () => {
    const entries = buildStageEntries([camera(5, null), camera(6, 'U9')], ['U1'], 'U1');
    expect(entries.map((entry) => entry.key)).toEqual(['photo-U1', 'tile-5', 'tile-6']);
  });
});

describe('fitTileHeight', () => {
  it('fills the height with one tile when the window is wide enough', () => {
    expect(fitTileHeight([16 / 9], 1000, 300, 10)).toBe(300);
  });

  it('is limited by width for a single wide tile in a narrow window', () => {
    expect(fitTileHeight([2], 400, 1000, 10)).toBe(200);
  });

  it('wraps into rows when that makes tiles bigger', () => {
    // Four squares in a 500×500 window: a 2×2 grid of ~245px beats one row of ~117px.
    expect(fitTileHeight([1, 1, 1, 1], 500, 500, 10)).toBe(245);
  });

  it('mixes aspect ratios (a 16:9 video next to square photos) in one row', () => {
    // One row: floor(1.78h) + 2h + 2 gaps ≤ 1000 → h = 259; two rows would cap h at 145.
    expect(fitTileHeight([16 / 9, 1, 1], 1000, 300, 10)).toBe(259);
  });

  it('gives 0 for nothing to show or no room', () => {
    expect(fitTileHeight([], 500, 500, 10)).toBe(0);
    expect(fitTileHeight([1], 0, 500, 10)).toBe(0);
  });
});

describe('nameWithPronouns', () => {
  it('wraps pronouns in parentheses like Slack, or leaves them out', () => {
    expect(nameWithPronouns('Sofia Egan', ' they/them ')).toEqual({ name: 'Sofia Egan', pronouns: '(they/them)' });
    expect(nameWithPronouns('Ada', undefined)).toEqual({ name: 'Ada', pronouns: '' });
  });
});
