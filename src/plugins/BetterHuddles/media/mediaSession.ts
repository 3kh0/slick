/**
 * The media side of a huddle (audio, camera, screen share). Slack hands
 * rooms.join callers an AWS Chime meeting + attendee (`call.free_willy`); the
 * browser connects to Chime directly with them.
 */

/** Chime CreateMeeting / CreateAttendee objects, passed through untouched to the SDK. */
export interface ChimeCredentials {
  meeting: Record<string, unknown>;
  attendee: Record<string, unknown>;
}

export interface MediaCallbacks {
  /** Slack user ids currently talking (including you). */
  onSpeaking: (userIds: Set<string>) => void;
  /** Slack user ids whose microphone is muted (as Chime reports it). */
  onMutedChanged: (userIds: Set<string>) => void;
  /** The connection dropped or Chime ended the meeting; `reason` is for the user. */
  onEnded: (reason: string) => void;
  /** Video tiles (cameras and screen shares, yours included) after any change. */
  onTilesChanged: (tiles: VideoTile[]) => void;
  /** Your screen share stopped on its own (e.g. the browser's "Stop sharing" button). */
  onScreenShareEnded: () => void;
  /** Slack user ids connected to the call's audio, in join order (you included). */
  onParticipantsChanged: (userIds: string[]) => void;
}

/** One video stream to show. `tileId` is what `bindTile` attaches a <video> to. */
export interface VideoTile {
  tileId: number;
  /** Slack user the video belongs to; null when Chime's attendee id can't be mapped. */
  userId: string | null;
  isLocal: boolean;
  /** A screen share rather than a camera. */
  isContent: boolean;
}

export interface MediaSession {
  setMuted: (muted: boolean) => void;
  setAudioInput: (deviceId: string) => Promise<void>;
  setAudioOutput: (deviceId: string) => Promise<void>;
  /** Turns your camera on/off; rejects with a user-readable error (e.g. permission denied). */
  setCamera: (enabled: boolean) => Promise<void>;
  /**
   * Sends a shader (shaderVideo.ts) instead of your camera, camera on or not; null stops it.
   * Rejects with ShaderCompileError if it doesn't compile, leaving the previous video running.
   */
  setShader: (source: string | null) => Promise<void>;
  /** Starts (after the browser's screen picker) or stops sharing your screen. */
  setScreenShare: (enabled: boolean) => Promise<void>;
  bindTile: (tileId: number, element: HTMLVideoElement) => void;
  unbindTile: (tileId: number) => void;
  /** How tall (CSS px) video tiles are on screen, so only that much resolution is downloaded; 0 = not visible. */
  setVideoDisplayHeight: (cssPixels: number) => void;
  stop: () => Promise<void>;
}

export interface MediaSessionOptions {
  audioInputId?: string;
  audioOutputId?: string;
  credentials: ChimeCredentials;
  /** Your Slack user id, for your own speaking indicator. */
  localUserId: string;
  callbacks: MediaCallbacks;
  /** Mute the mic before audio starts, so a muted join never sends any audio. */
  startMuted?: boolean;
  /** Receives the Chime SDK's log lines for the copyable call log. */
  log?: (level: 'debug' | 'info' | 'warn' | 'error', message: string) => void;
}

/** Connects and resolves once audio is flowing; rejects with a user-readable error otherwise. */
export type MediaSessionFactory = (options: MediaSessionOptions) => Promise<MediaSession>;

// Chime reports volume 0..1; above this someone is audibly talking.
const SPEAKING_VOLUME = 0.15;

/** A set of user ids that reports a copy of itself only when membership actually changes. */
function createReportedSet(onChange: (userIds: Set<string>) => void) {
  const members = new Set<string>();
  return (userId: string, isMember: boolean): void => {
    if (members.has(userId) === isMember) return;
    if (isMember) members.add(userId);
    else members.delete(userId);
    onChange(new Set(members));
  };
}

/**
 * Tracks who's speaking (and who's muted) from per-user volume readings,
 * reporting only changes; volume callbacks fire many times a second.
 * `muted: null` means Chime didn't say, so the muted state is left as it was.
 */
export function createSpeakingTracker(
  onSpeaking: (userIds: Set<string>) => void,
  onMuted: (userIds: Set<string>) => void = () => {},
) {
  const setSpeaking = createReportedSet(onSpeaking);
  const setMuted = createReportedSet(onMuted);

  return {
    update(userId: string, volume: number | null, muted: boolean | null = null): void {
      if (muted !== null) setMuted(userId, muted);
      setSpeaking(userId, !muted && (volume ?? 0) > SPEAKING_VOLUME);
    },
    remove(userId: string): void {
      setSpeaking(userId, false);
      setMuted(userId, false);
    },
  };
}

// Chime's screen share joins as a second attendee with this suffix; it isn't a separate person.
const CONTENT_ATTENDEE_SUFFIX = '#content';

/**
 * Who's in the call, from Chime attendee presence. One person can be connected
 * more than once (two devices, or a screen share attendee), so each user is
 * counted until their last attendee leaves. Reports only real changes.
 */
export function createParticipantTracker(onChange: (userIds: string[]) => void) {
  const attendeesByUser = new Map<string, Set<string>>();

  return {
    update(attendeeId: string, userId: string, present: boolean): void {
      if (attendeeId.endsWith(CONTENT_ATTENDEE_SUFFIX)) return;
      const attendees = attendeesByUser.get(userId);
      if (present) {
        if (attendees?.has(attendeeId)) return;
        if (attendees) return void attendees.add(attendeeId);
        attendeesByUser.set(userId, new Set([attendeeId]));
        onChange([...attendeesByUser.keys()]);
        return;
      }
      if (!attendees?.delete(attendeeId) || attendees.size > 0) return;
      attendeesByUser.delete(userId);
      onChange([...attendeesByUser.keys()]);
    },
  };
}

/**
 * Keeps the current set of video tiles and reports it after every change,
 * screen shares first (they're what people want to look at), then cameras.
 */
export function createTileTracker(onChange: (tiles: VideoTile[]) => void) {
  const tiles = new Map<number, VideoTile>();
  const report = () =>
    onChange(
      [...tiles.values()].toSorted(
        (first, second) => Number(second.isContent) - Number(first.isContent) || first.tileId - second.tileId,
      ),
    );

  return {
    upsert(tile: VideoTile): void {
      const previous = tiles.get(tile.tileId);
      if (
        previous &&
        previous.userId === tile.userId &&
        previous.isLocal === tile.isLocal &&
        previous.isContent === tile.isContent
      )
        return;
      tiles.set(tile.tileId, tile);
      report();
    },
    remove(tileId: number): void {
      if (tiles.delete(tileId)) report();
    },
    clear(): void {
      if (tiles.size === 0) return;
      tiles.clear();
      report();
    },
  };
}

/** The parts of Chime's VideoTileState that decide whether a tile has video to show. */
export interface ChimeTileSnapshot {
  tileId: number | null;
  localTile: boolean;
  boundAttendeeId: string | null;
  boundVideoStream: MediaStream | null;
}

/**
 * Whether a Chime tile should get a <video> in the UI. Deliberately not Chime's
 * `active` flag: that also requires a <video> to be bound already, and we only
 * create (and bind) one for tiles we show, so `active` would hide every tile.
 * Paused / poor-connection tiles stay up (they show their last frame).
 */
export function tileHasVideo(state: ChimeTileSnapshot): boolean {
  return (
    state.tileId !== null && Boolean(state.boundVideoStream) && (state.localTile || Boolean(state.boundAttendeeId))
  );
}

/**
 * What Slack's Chime attendee is allowed to do with video. Capabilities are
 * optional in Chime (absent = send + receive); we've never seen Slack's values,
 * so anything unrecognised is treated as allowed and left to Chime to enforce.
 */
export function videoCapabilities(attendee: Record<string, unknown>): { canSend: boolean; canReceive: boolean } {
  const video = (attendee.Capabilities as { Video?: unknown } | undefined)?.Video;
  return { canSend: video !== 'None' && video !== 'Receive', canReceive: video !== 'None' && video !== 'Send' };
}

export type MediaDevice = 'microphone' | 'camera' | 'screen';

const DEVICE_HINTS: Record<MediaDevice, { blocked: string; missing: string }> = {
  microphone: {
    blocked: 'Microphone access was blocked. Allow the microphone for this site in your browser, then join again.',
    missing: 'No microphone was found. Plug one in, then join again.',
  },
  camera: {
    blocked: 'Camera access was blocked. Allow the camera for this site in your browser, then try again.',
    missing: 'No camera was found.',
  },
  screen: {
    blocked: 'Screen sharing was cancelled or blocked by the browser.',
    missing: 'There was nothing to share.',
  },
};

/** Turns getUserMedia / getDisplayMedia failures into messages that say what to do. */
export function mediaDeviceError(device: MediaDevice, error: unknown): Error {
  const name = (error as Error)?.name;
  if (name === 'NotAllowedError' || name === 'PermissionDeniedError' || name === 'AbortError')
    return new Error(DEVICE_HINTS[device].blocked);
  if (name === 'NotFoundError') return new Error(DEVICE_HINTS[device].missing);
  return new Error(`Couldn't start the ${device}: ${(error as Error)?.message ?? String(error)}`);
}

/**
 * Slack's Chime ExternalUserId format isn't documented; we take the first
 * Slack-looking user id in it (it may be bare "U123" or prefixed/suffixed).
 */
export function slackUserIdFromExternalId(externalUserId: string | undefined): string | null {
  const match = /(?:^|[^A-Z0-9])([UW][A-Z0-9]{2,})(?=$|[^A-Z0-9])/.exec(externalUserId ?? '');
  return match ? match[1] : null;
}

/** Loads the Chime SDK session; kept behind an import so tests of this file never pull in the SDK. */
export const createMediaSession: MediaSessionFactory = async (options) => {
  const { createChimeMediaSession } = await import('./chimeMedia.ts');
  return createChimeMediaSession(options);
};
