import { describe, it } from 'node:test';
import { expect } from '../expect.ts';
import { buildStageEntries, nameWithPronouns } from '../../media/stageLayout.ts';

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

describe('nameWithPronouns', () => {
  it('wraps pronouns in parentheses like Slack, or leaves them out', () => {
    expect(nameWithPronouns('Sofia Egan', ' they/them ')).toEqual({ name: 'Sofia Egan', pronouns: '(they/them)' });
    expect(nameWithPronouns('Ada', undefined)).toEqual({ name: 'Ada', pronouns: '' });
  });
});
