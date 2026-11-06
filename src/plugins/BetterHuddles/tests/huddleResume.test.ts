import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { IDLE_CALL, type CallState } from '../huddleCall.ts';
import {
  RESUME_WINDOW_MS,
  resumeHuddleAfterReload,
  roomHasEnded,
  saveHuddleForReload,
  takeHuddleToResume,
} from '../huddleResume.ts';

function memoryStorage(initial: Record<string, string> = {}) {
  const items = new Map(Object.entries(initial));
  return {
    items,
    getItem: (key: string) => items.get(key) ?? null,
    setItem: (key: string, value: string) => void items.set(key, value),
    removeItem: (key: string) => void items.delete(key),
  };
}

const connected: CallState = { ...IDLE_CALL, status: 'connected', channelId: 'C1', roomId: 'R1', muted: true };

describe('saving and taking the huddle to resume', () => {
  it('remembers the huddle you were in and hands it back once', () => {
    const storage = memoryStorage();
    saveHuddleForReload(connected, storage, 1_000);
    assert.deepEqual(takeHuddleToResume(storage, 2_000), {
      channelId: 'C1',
      roomId: 'R1',
      savedAt: 1_000,
    });
    assert.equal(takeHuddleToResume(storage, 2_000), null);
  });

  it('notes nothing when you are not in a connected huddle', () => {
    const storage = memoryStorage();
    saveHuddleForReload({ ...connected, status: 'joining' }, storage);
    saveHuddleForReload({ ...connected, roomId: '' }, storage);
    assert.equal(storage.items.size, 0);
  });

  it('ignores a note older than the resume window, from the future, or malformed', () => {
    const storage = memoryStorage();
    saveHuddleForReload(connected, storage, 0);
    assert.equal(takeHuddleToResume(storage, RESUME_WINDOW_MS + 1), null);
    saveHuddleForReload(connected, storage, 5_000);
    assert.equal(takeHuddleToResume(storage, 1_000), null);
    storage.setItem('slick-better-huddles:huddle-resume', '{not json');
    assert.equal(takeHuddleToResume(storage), null);
    storage.setItem('slick-better-huddles:huddle-resume', JSON.stringify({ channelId: 'C1' }));
    assert.equal(takeHuddleToResume(storage), null);
  });

  it("doesn't throw when storage is blocked", () => {
    const blocked = {
      getItem: () => {
        throw new Error('blocked');
      },
      setItem: () => {
        throw new Error('blocked');
      },
      removeItem: () => {},
    };
    const warn = console.warn;
    console.warn = () => {};
    try {
      assert.doesNotThrow(() => saveHuddleForReload(connected, blocked));
    } finally {
      console.warn = warn;
    }
    assert.equal(takeHuddleToResume(blocked), null);
  });
});

describe('roomHasEnded', () => {
  it('reads has_ended / date_end', () => {
    assert.equal(roomHasEnded({ has_ended: false, date_end: 0 }), false);
    assert.equal(roomHasEnded({ has_ended: true }), true);
    assert.equal(roomHasEnded({ date_end: 1793912915 }), true);
    assert.equal(roomHasEnded(undefined), true);
  });
});

describe('resumeHuddleAfterReload', () => {
  const saved = (call: CallState = connected) => {
    const storage = memoryStorage();
    saveHuddleForReload(call, storage);
    return storage;
  };

  it('rejoins a huddle that is still going, muted even if you were unmuted before the reload', async () => {
    const joins: unknown[] = [];
    const outcome = await resumeHuddleAfterReload({
      storage: saved({ ...connected, muted: false }),
      roomInfo: async () => ({ has_ended: false }),
      join: async (channelId, options) => void joins.push([channelId, options]),
    });
    assert.equal(outcome, 'rejoined');
    assert.deepEqual(joins, [['C1', { muted: true }]]);
  });

  it("doesn't restart an ended huddle (that would ring the channel)", async () => {
    let joined = false;
    const outcome = await resumeHuddleAfterReload({
      storage: saved(),
      roomInfo: async () => ({ has_ended: true }),
      join: async () => void (joined = true),
    });
    assert.equal(outcome, 'ended');
    assert.equal(joined, false);
  });

  it("doesn't join when the room can't be checked", async () => {
    let joined = false;
    const warn = console.warn;
    console.warn = () => {};
    try {
      const outcome = await resumeHuddleAfterReload({
        storage: saved(),
        roomInfo: async () => {
          throw new Error('ratelimited');
        },
        join: async () => void (joined = true),
      });
      assert.equal(outcome, 'failed');
    } finally {
      console.warn = warn;
    }
    assert.equal(joined, false);
  });

  it('does nothing without a note', async () => {
    const outcome = await resumeHuddleAfterReload({
      storage: memoryStorage(),
      roomInfo: async () => assert.fail('should not check a room'),
      join: async () => assert.fail('should not join'),
    });
    assert.equal(outcome, 'none');
  });
});
