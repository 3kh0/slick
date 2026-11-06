/**
 * Video quality decisions (what we receive, and how we send our camera), kept
 * free of the Chime SDK so they're testable. Receiving: Chime's default downlink policy
 * (AllHighestVideoBandwidthPolicy) always subscribes to every sender's highest
 * layer and never backs off, so on a constrained connection packets queue up
 * and video falls further and further behind. chimeVideo.ts instead uses
 * VideoPriorityBasedPolicy (server-side network adaptation) with these
 * preferences: only the resolution the tiles can actually show, screen shares first.
 */

/** Mirrors Chime's TargetDisplaySize enum (Low…Maximum simulcast layers). */
export const TARGET_DISPLAY_SIZE = { low: 0, medium: 1, high: 2, maximum: 3 } as const;
export type TargetDisplaySizeLevel = (typeof TARGET_DISPLAY_SIZE)[keyof typeof TARGET_DISPLAY_SIZE];

// Chime appends this to an attendee id for its screen-share ("content") stream.
const CONTENT_SUFFIX = '#content';
// Lower number = higher priority to Chime: screen shares are what people are reading.
const CONTENT_PRIORITY = 1;
const CAMERA_PRIORITY = 2;

/** Which simulcast layer covers a tile this many device pixels tall. */
export function targetSizeForHeight(devicePixels: number): TargetDisplaySizeLevel {
  if (devicePixels <= 180) return TARGET_DISPLAY_SIZE.low;
  if (devicePixels <= 360) return TARGET_DISPLAY_SIZE.medium;
  if (devicePixels <= 720) return TARGET_DISPLAY_SIZE.high;
  return TARGET_DISPLAY_SIZE.maximum;
}

export interface VideoPreferenceSpec {
  attendeeId: string;
  priority: number;
  targetSize: TargetDisplaySizeLevel;
}

/**
 * One preference per sending attendee. Screen shares get top priority and at
 * least the High layer (text must stay readable even in a small window).
 */
export function videoPreferencesFor(
  attendeeIds: string[],
  cameraTargetSize: TargetDisplaySizeLevel,
): VideoPreferenceSpec[] {
  return [...new Set(attendeeIds)].map((attendeeId) => {
    const isContent = attendeeId.endsWith(CONTENT_SUFFIX);
    return {
      attendeeId,
      priority: isContent ? CONTENT_PRIORITY : CAMERA_PRIORITY,
      targetSize: isContent
        ? (Math.max(cameraTargetSize, TARGET_DISPLAY_SIZE.high) as TargetDisplaySizeLevel)
        : cameraTargetSize,
    };
  });
}

export interface InboundVideoSummary {
  resolution: string;
  framesPerSecond: number;
  /** Average time frames waited in the jitter buffer: the main "how far behind" number. */
  jitterBufferMs: number;
  framesDropped: number;
  packetsLost: number;
}

export interface VideoStatsSummary {
  inbound: InboundVideoSummary[];
  roundTripMs: number | null;
  availableIncomingKbps: number | null;
}

type StatsEntry = Record<string, unknown> & { type?: string; kind?: string };

const numberOr = (value: unknown, fallback: number) =>
  typeof value === 'number' && Number.isFinite(value) ? value : fallback;

/** Boils a WebRTC stats report down to what explains video lag. */
export function summarizeVideoStats(entries: StatsEntry[]): VideoStatsSummary {
  const inbound = entries
    .filter((entry) => entry.type === 'inbound-rtp' && entry.kind === 'video')
    .map((entry) => {
      const emitted = numberOr(entry.jitterBufferEmittedCount, 0);
      return {
        resolution: `${numberOr(entry.frameWidth, 0)}x${numberOr(entry.frameHeight, 0)}`,
        framesPerSecond: numberOr(entry.framesPerSecond, 0),
        jitterBufferMs: emitted > 0 ? Math.round((numberOr(entry.jitterBufferDelay, 0) / emitted) * 1000) : 0,
        framesDropped: numberOr(entry.framesDropped, 0),
        packetsLost: numberOr(entry.packetsLost, 0),
      };
    });
  const pair = entries.find(
    (entry) => entry.type === 'candidate-pair' && entry.nominated === true && entry.state === 'succeeded',
  );
  const roundTrip = pair ? numberOr(pair.currentRoundTripTime, NaN) : NaN;
  const incoming = pair ? numberOr(pair.availableIncomingBitrate, NaN) : NaN;
  return {
    inbound,
    roundTripMs: Number.isNaN(roundTrip) ? null : Math.round(roundTrip * 1000),
    availableIncomingKbps: Number.isNaN(incoming) ? null : Math.round(incoming / 1000),
  };
}

export type BrowserFamily = 'chromium' | 'firefox' | 'safari' | 'other';
export type SendCodec = 'vp8' | 'h264';

/** How your camera is captured and encoded for others. */
export interface UplinkVideoPlan {
  /**
   * Send several resolutions at once so Chime's server can give each receiver
   * the one their connection handles. Chime only supports this on Chromium.
   */
  simulcast: boolean;
  /** Codec order to send; null keeps Chime's default (needed with simulcast). */
  codecs: SendCodec[] | null;
  capture: MediaTrackConstraints;
}

const HD_CAPTURE: MediaTrackConstraints = { width: { ideal: 1280 }, height: { ideal: 720 }, frameRate: { ideal: 15 } };
// Without simulcast every receiver gets this one stream, so it has to suit the weakest connection.
const SINGLE_STREAM_CAPTURE: MediaTrackConstraints = {
  width: { ideal: 640 },
  height: { ideal: 360 },
  frameRate: { ideal: 15 },
};

/**
 * Why not Chime's defaults: without simulcast Chime sends one VP9 stream first.
 * VP9 is costly to encode in software (frames get dropped when the CPU can't
 * keep up, which looks like freezing) and one fixed stream can't suit every
 * receiver (so it's inconsistent between viewers). Chromium gets simulcast;
 * other browsers send a lighter single stream in the codec they encode best
 * (Firefox: VP8 via libvpx; Safari: hardware H.264).
 */
export function uplinkVideoPlan(browser: BrowserFamily): UplinkVideoPlan {
  if (browser === 'chromium') return { simulcast: true, codecs: null, capture: HD_CAPTURE };
  if (browser === 'safari') return { simulcast: false, codecs: ['h264', 'vp8'], capture: SINGLE_STREAM_CAPTURE };
  return { simulcast: false, codecs: ['vp8', 'h264'], capture: SINGLE_STREAM_CAPTURE };
}

/** Maps Chime's browser name (e.g. "firefox", "safari", "ios") to the families above. */
export function browserFamily(hasChromiumWebRTC: boolean, browserName: string): BrowserFamily {
  if (hasChromiumWebRTC) return 'chromium';
  const name = browserName.toLowerCase();
  if (name.includes('firefox')) return 'firefox';
  if (name.includes('safari') || name === 'ios' || name.includes('webkit')) return 'safari';
  return 'other';
}
