import { describe, it } from 'node:test';
import { expect, mockFn, itEach } from '../expect.ts';
import {
  createSpeakingTracker,
  createTileTracker,
  mediaDeviceError,
  slackUserIdFromExternalId,
  tileHasVideo,
  videoCapabilities,
} from '../../media/mediaSession.ts';

describe('createSpeakingTracker', () => {
  it('reports only when the set of speakers changes', () => {
    const onChange = mockFn();
    const tracker = createSpeakingTracker(onChange);
    tracker.update('U1', 0.5);
    tracker.update('U1', 0.6);
    tracker.update('U2', 0.01);
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenLastCalledWith(new Set(['U1']));
    tracker.update('U1', 0.02);
    expect(onChange).toHaveBeenLastCalledWith(new Set());
  });

  it('treats muted or missing volume as silent, and removal as stopping', () => {
    const onChange = mockFn();
    const tracker = createSpeakingTracker(onChange);
    tracker.update('U1', 0.9, true);
    tracker.update('U2', null);
    expect(onChange).not.toHaveBeenCalled();
    tracker.update('U3', 0.9);
    tracker.remove('U3');
    expect(onChange).toHaveBeenLastCalledWith(new Set());
  });
});

describe('slackUserIdFromExternalId', () => {
  itEach([
    ['U0123ABC', 'U0123ABC'],
    ['T0999-U0123ABC', 'U0123ABC'],
    ['U0123ABC#device-1', 'U0123ABC'],
    ['W0123ABC', 'W0123ABC'],
  ])('finds the user id in %s', (externalId, userId) => {
    expect(slackUserIdFromExternalId(externalId)).toBe(userId);
  });

  itEach([undefined, '', 'guest-42', 'AU0123ABC'])('returns null for %s', (externalId) => {
    expect(slackUserIdFromExternalId(externalId)).toBeNull();
  });
});

describe('createTileTracker', () => {
  const tile = (tileId: number, isContent = false) => ({ tileId, userId: 'U1', isLocal: false, isContent });

  it('orders screen shares first, then by tile id, and skips no-op updates', () => {
    const onChange = mockFn();
    const tracker = createTileTracker(onChange);
    tracker.upsert(tile(5));
    tracker.upsert(tile(2));
    tracker.upsert(tile(9, true));
    tracker.upsert(tile(2));
    expect(onChange).toHaveBeenCalledTimes(3);
    expect(onChange.calls.at(-1)?.[0].map((entry: { tileId: number }) => entry.tileId)).toEqual([9, 2, 5]);
  });

  it('reports removals and clears, but not removals of unknown tiles', () => {
    const onChange = mockFn();
    const tracker = createTileTracker(onChange);
    tracker.upsert(tile(1));
    tracker.remove(42);
    tracker.remove(1);
    expect(onChange).toHaveBeenLastCalledWith([]);
    expect(onChange).toHaveBeenCalledTimes(2);
    tracker.clear();
    expect(onChange).toHaveBeenCalledTimes(2);
  });
});

describe('mediaDeviceError', () => {
  const named = (name: string) => Object.assign(new Error('raw'), { name });

  it('explains blocked and missing devices per device', () => {
    expect(mediaDeviceError('camera', named('NotAllowedError')).message).toMatch(/Camera access was blocked/);
    expect(mediaDeviceError('microphone', named('NotFoundError')).message).toMatch(/No microphone/);
    expect(mediaDeviceError('screen', named('NotAllowedError')).message).toMatch(/cancelled/);
  });

  it('keeps the original message for anything else', () => {
    expect(mediaDeviceError('camera', named('NotReadableError')).message).toBe("Couldn't start the camera: raw");
  });
});

describe('tileHasVideo', () => {
  const stream = {} as MediaStream;

  it('shows a remote tile as soon as its stream arrives, before any <video> is bound', () => {
    // Regression: Chime's own `active` flag needs a bound <video>, which we only create for shown tiles.
    expect(tileHasVideo({ tileId: 4, localTile: false, boundAttendeeId: 'attendee-2', boundVideoStream: stream })).toBe(
      true,
    );
  });

  it('shows your own camera tile', () => {
    expect(tileHasVideo({ tileId: 1, localTile: true, boundAttendeeId: null, boundVideoStream: stream })).toBe(true);
  });

  it('hides tiles without a stream (camera stopped) or not yet tied to anyone', () => {
    expect(tileHasVideo({ tileId: 1, localTile: true, boundAttendeeId: 'me', boundVideoStream: null })).toBe(false);
    expect(tileHasVideo({ tileId: 4, localTile: false, boundAttendeeId: null, boundVideoStream: stream })).toBe(false);
    expect(tileHasVideo({ tileId: null, localTile: false, boundAttendeeId: 'a', boundVideoStream: stream })).toBe(
      false,
    );
  });
});

describe('videoCapabilities', () => {
  itEach([
    [{}, true, true],
    [{ Capabilities: { Video: 'SendReceive' } }, true, true],
    [{ Capabilities: { Video: 'Receive' } }, false, true],
    [{ Capabilities: { Video: 'Send' } }, true, false],
    [{ Capabilities: { Video: 'None' } }, false, false],
  ])('%o → send %s, receive %s', (attendee, canSend, canReceive) => {
    expect(videoCapabilities(attendee)).toEqual({ canSend, canReceive });
  });
});

describe('createSpeakingTracker muted state', () => {
  it('reports mute changes, keeps the last known state when Chime says null, and clears on removal', () => {
    const onMuted = mockFn();
    const tracker = createSpeakingTracker(() => {}, onMuted);
    tracker.update('U1', 0, true);
    expect(onMuted).toHaveBeenLastCalledWith(new Set(['U1']));
    tracker.update('U1', 0, null);
    expect(onMuted).toHaveBeenCalledTimes(1);
    tracker.remove('U1');
    expect(onMuted).toHaveBeenLastCalledWith(new Set());
  });

  it('never shows a muted person as speaking', () => {
    const onSpeaking = mockFn();
    const tracker = createSpeakingTracker(onSpeaking);
    tracker.update('U1', 0.9, true);
    expect(onSpeaking).not.toHaveBeenCalled();
  });
});
