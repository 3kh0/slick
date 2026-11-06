import { describe, it } from 'node:test';
import { expect, itEach } from '../expect.ts';
import {
  summarizeVideoStats,
  TARGET_DISPLAY_SIZE,
  targetSizeForHeight,
  videoPreferencesFor,
} from '../../media/videoQuality.ts';

describe('targetSizeForHeight', () => {
  itEach([
    [0, TARGET_DISPLAY_SIZE.low],
    [180, TARGET_DISPLAY_SIZE.low],
    [181, TARGET_DISPLAY_SIZE.medium],
    [360, TARGET_DISPLAY_SIZE.medium],
    [720, TARGET_DISPLAY_SIZE.high],
    [1080, TARGET_DISPLAY_SIZE.maximum],
  ])('%i device px → layer %i', (pixels, level) => {
    expect(targetSizeForHeight(pixels)).toBe(level);
  });
});

describe('videoPreferencesFor', () => {
  it('puts screen shares first (lower number = higher priority) and never below the High layer', () => {
    expect(videoPreferencesFor(['att-1', 'att-2#content', 'att-1'], TARGET_DISPLAY_SIZE.low)).toEqual([
      { attendeeId: 'att-1', priority: 2, targetSize: TARGET_DISPLAY_SIZE.low },
      { attendeeId: 'att-2#content', priority: 1, targetSize: TARGET_DISPLAY_SIZE.high },
    ]);
  });

  it('lets a big window ask for the maximum layer for everything', () => {
    expect(videoPreferencesFor(['att-2#content'], TARGET_DISPLAY_SIZE.maximum)[0].targetSize).toBe(
      TARGET_DISPLAY_SIZE.maximum,
    );
  });
});

describe('summarizeVideoStats', () => {
  it('reports per-stream lag and the connection round trip', () => {
    const summary = summarizeVideoStats([
      {
        type: 'inbound-rtp',
        kind: 'video',
        frameWidth: 640,
        frameHeight: 360,
        framesPerSecond: 15,
        jitterBufferDelay: 12,
        jitterBufferEmittedCount: 100,
        framesDropped: 3,
        packetsLost: 7,
      },
      { type: 'inbound-rtp', kind: 'audio', jitterBufferDelay: 99 },
      {
        type: 'candidate-pair',
        nominated: true,
        state: 'succeeded',
        currentRoundTripTime: 0.085,
        availableIncomingBitrate: 2_500_000,
      },
      { type: 'candidate-pair', nominated: false, state: 'failed', currentRoundTripTime: 9 },
    ]);
    expect(summary).toEqual({
      inbound: [{ resolution: '640x360', framesPerSecond: 15, jitterBufferMs: 120, framesDropped: 3, packetsLost: 7 }],
      roundTripMs: 85,
      availableIncomingKbps: 2500,
    });
  });

  it('copes with missing fields and no active connection', () => {
    expect(summarizeVideoStats([{ type: 'inbound-rtp', kind: 'video' }])).toEqual({
      inbound: [{ resolution: '0x0', framesPerSecond: 0, jitterBufferMs: 0, framesDropped: 0, packetsLost: 0 }],
      roundTripMs: null,
      availableIncomingKbps: null,
    });
  });
});
