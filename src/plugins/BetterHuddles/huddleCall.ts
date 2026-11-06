// The huddle you're in.
// Joining is rooms.join (which also starts a huddle if none is running), then
// connecting straight to AWS Chime with the credentials it returns, so Slack's
// own huddle client is never involved. Audio starts with the call; camera and
// screen share are opt-in toggles.

import type { ChimeCredentials, MediaSession, MediaSessionFactory, VideoTile } from './media/mediaSession.ts';
import type { CallPreferences } from './preferences.ts';
import { createCallLog, describeError, type CallLog } from './callLog.ts';
import { callWithFallback, postSlackMethod, type TeamCredential } from './slackApi.ts';
import { createValueStore } from './valueStore.ts';

export type CallStatus = 'idle' | 'joining' | 'connected' | 'failed';

export interface CallState {
  status: CallStatus;
  channelId: string;
  roomId: string;
  muted: boolean;
  /** Slack user ids currently talking. */
  speaking: Set<string>;
  /** Slack user ids with their microphone muted (from Chime; may lag a moment). */
  mutedUsers: Set<string>;
  /** Slack user ids connected to the call (from Chime presence). */
  participants: string[];
  /** Your Slack user id in the team the call was joined with. */
  localUserId: string;
  /** Date.now() when audio connected. */
  connectedAt: number;
  cameraOn: boolean;
  /** Your video is the shader from `preferences.shaderSource` (sent even with the camera off). */
  shaderOn: boolean;
  screenSharing: boolean;
  /** Cameras and screen shares to show (yours included), screen shares first. */
  tiles: VideoTile[];
  /** Why joining failed, or why the call ended on its own; shown in the call window. */
  message: string;
}

interface RoomsJoinResponse {
  call?: { call_id?: string; free_willy?: { meeting?: Record<string, unknown>; attendee?: Record<string, unknown> } };
  huddle?: { id?: string };
}

export const IDLE_CALL: CallState = {
  status: 'idle',
  channelId: '',
  roomId: '',
  muted: false,
  speaking: new Set(),
  mutedUsers: new Set(),
  participants: [],
  localUserId: '',
  connectedAt: 0,
  cameraOn: false,
  shaderOn: false,
  screenSharing: false,
  tiles: [],
  message: '',
};

/**
 * Chime region to ask for when starting a huddle. Only regions seen working in
 * third-party clients are used; joining an existing huddle uses that huddle's
 * region regardless.
 */
export function preferredHuddleRegion(timeZone: string): string {
  if (/^(Australia|Pacific|Asia|Indian)\//.test(timeZone)) return 'ap-southeast-2';
  if (/^America\/(Los_Angeles|Vancouver|Tijuana|Phoenix|Denver|Boise|Edmonton|Anchorage)$/.test(timeZone)) {
    return 'us-west-1';
  }
  return 'us-east-2';
}

export function credentialsFrom(response: RoomsJoinResponse): ChimeCredentials {
  const meeting = response.call?.free_willy?.meeting;
  const attendee = response.call?.free_willy?.attendee;
  if (!meeting || !attendee) {
    throw new Error(
      "Slack didn't return audio credentials for this huddle (no call.free_willy). This workspace may use a huddle backend Better Huddles doesn't support.",
    );
  }
  return { meeting, attendee };
}

export interface HuddleCallDeps {
  /** Tokens that may act for the current window, best first. */
  teams: () => TeamCredential[];
  createMedia: MediaSessionFactory;
  timeZone?: () => string;
  join?: typeof callWithFallback;
  post?: typeof postSlackMethod;
  /** Where join steps and Chime's messages go; shown (and copyable) in the call window. */
  log?: CallLog;
  /** Shader code to start from; it outlives any one call. */
  preferences: CallPreferences;
  /** Called after every preferences change, to remember it. */
  savePreferences?: (preferences: CallPreferences) => void;
}

/** What rooms.leave needs to take you out of a room you joined. */
interface JoinedRoom {
  /** The token rooms.join worked with; rooms.leave must use the same one. */
  team: TeamCredential;
  channelId: string;
  /** rooms.join's `call.call_id` (R…). */
  callId: string;
  /** Your Chime attendee id from rooms.join's credentials. */
  attendeeId: string;
}

/** Slack's own client sends `user_initiated`, or `unload` from its page-unload beacon. */
type LeaveReason = 'user_initiated' | 'unload';

const browserTimeZone = () => Intl.DateTimeFormat().resolvedOptions().timeZone ?? '';

export function createHuddleCall({
  teams,
  createMedia,
  timeZone = browserTimeZone,
  join: joinWithFallback = callWithFallback,
  post = postSlackMethod,
  log = createCallLog(),
  preferences: initialPreferences,
  savePreferences = () => {},
}: HuddleCallDeps) {
  const state = createValueStore<CallState>(IDLE_CALL);
  const preferences = createValueStore<CallPreferences>(initialPreferences);
  let media: MediaSession | null = null;
  let joinedRoom: JoinedRoom | null = null;
  // Bumped by every join/leave so a slow join that was cancelled can tell it's stale.
  let attempt = 0;

  /**
   * rooms.leave with the arguments Slack's own client sends (its `leaveRoom`
   * fetcher). Dropping the Chime connection already takes you out of the audio;
   * this stops Slack from still listing you in the huddle.
   */
  async function tellSlackWeLeft(room: JoinedRoom, reason: LeaveReason, keepalive = false) {
    const params = { channel_id: room.channelId, call_id: room.callId, attendee_id: room.attendeeId, reason };
    try {
      await post(room.team, 'rooms.leave', params, { keepalive });
      log.add('info', `rooms.leave sent for ${room.callId} (${reason})`);
    } catch (error) {
      const message = `rooms.leave failed (audio is already disconnected): ${(error as Error).message}`;
      log.add('warn', message);
      console.warn(`[slick] [Better Huddles] ${message}`);
    }
  }

  async function connectMedia(
    credentials: ChimeCredentials,
    localUserId: string,
    thisAttempt: number,
    muted: boolean,
    cameraInputId?: string,
  ) {
    const isCurrent = () => thisAttempt === attempt;
    const patch = (change: Partial<CallState>) => isCurrent() && state.update((current) => ({ ...current, ...change }));
    return createMedia({
      audioInputId: preferences.get().audioInputId,
      audioOutputId: preferences.get().audioOutputId,
      cameraInputId,
      credentials,
      localUserId,
      startMuted: muted,
      log: log.add,
      callbacks: {
        onSpeaking: (speaking) => patch({ speaking }),
        onMutedChanged: (mutedUsers) => patch({ mutedUsers }),
        onTilesChanged: (tiles) => patch({ tiles }),
        onParticipantsChanged: (participants) => patch({ participants }),
        onScreenShareEnded: () => patch({ screenSharing: false }),
        onEnded: (reason) => {
          if (!isCurrent()) return;
          log.add('warn', `call ended by Chime: ${reason}`);
          attempt++;
          media = null;
          joinedRoom = null;
          state.set({ ...IDLE_CALL, status: 'failed', message: reason });
        },
      },
    });
  }

  /** Joins (or starts) the huddle in a conversation. Failures end up in `state.message`. */
  async function join(
    channelId: string,
    {
      muted = false,
      cameraOn = false,
      cameraInputId,
    }: { muted?: boolean; cameraOn?: boolean; cameraInputId?: string } = {},
  ): Promise<void> {
    const current = state.get();
    const busy = current.status === 'joining' || current.status === 'connected';
    if (busy && current.channelId === channelId) return;
    if (busy) await leave();
    const thisAttempt = ++attempt;
    // Each attempt gets a fresh log, so what you copy is about this call.
    log.clear();
    log.add('info', `joining the huddle in ${channelId}${muted ? ' (muted)' : ''}`);
    state.set({ ...IDLE_CALL, status: 'joining', channelId });
    // Set once rooms.join has handed out an attendee: from then on Slack counts us in.
    let room: JoinedRoom | null = null;
    try {
      const candidates = teams();
      log.add(
        'info',
        `rooms.join, trying teams: ${candidates.map((candidate) => candidate.id).join(', ') || '(none)'}`,
      );
      const joined = await joinWithFallback<RoomsJoinResponse>(candidates, 'rooms.join', {
        channel_id: channelId,
        regions: preferredHuddleRegion(timeZone()),
      });
      const roomId = joined.result.call?.call_id ?? joined.result.huddle?.id ?? '';
      log.add('info', `rooms.join ok with team ${joined.team.id}: room ${roomId || '(no id)'}`);
      if (thisAttempt === attempt) state.update((joining) => ({ ...joining, localUserId: joined.team.userId }));
      const credentials = credentialsFrom(joined.result);
      logCredentials(credentials);
      const attendeeId = typeof credentials.attendee.AttendeeId === 'string' ? credentials.attendee.AttendeeId : '';
      if (roomId && attendeeId) room = { team: joined.team, channelId, callId: roomId, attendeeId };
      if (thisAttempt !== attempt) {
        if (room) await tellSlackWeLeft(room, 'user_initiated');
        return;
      }
      const session = await connectMedia(credentials, joined.team.userId, thisAttempt, muted, cameraInputId);
      if (thisAttempt !== attempt) {
        log.add('info', 'left while audio was connecting; hanging up');
        await session.stop();
        if (room) await tellSlackWeLeft(room, 'user_initiated');
        return;
      }
      media = session;
      joinedRoom = room;
      if (muted) session.setMuted(true);
      log.add('info', 'audio connected');
      // update, not set: tiles and participants may have arrived while connecting.
      state.update((connecting) => ({ ...connecting, status: 'connected', roomId, muted, connectedAt: Date.now() }));
      if (cameraOn) {
        try {
          await session.setCamera(true);
          if (thisAttempt === attempt) state.update((latest) => ({ ...latest, cameraOn: true }));
        } catch (error) {
          log.add('warn', `starting the preview camera failed: ${describeError(error)}`);
        }
      }
    } catch (error) {
      log.add('error', `join failed: ${describeError(error)}`);
      // Slack already counts us in after a successful rooms.join; don't leave a ghost participant.
      if (room) await tellSlackWeLeft(room, 'user_initiated');
      if (thisAttempt === attempt) {
        state.set({
          ...IDLE_CALL,
          status: 'failed',
          channelId,
          message: `Couldn't join the huddle: ${(error as Error).message}`,
        });
      }
    }
  }

  /** Logs which Chime meeting we're connecting to, without the attendee's join token. */
  function logCredentials({ meeting, attendee }: ChimeCredentials): void {
    if (typeof attendee.JoinToken === 'string') log.redact(attendee.JoinToken);
    const placement = (meeting.MediaPlacement ?? {}) as Record<string, unknown>;
    log.add(
      'info',
      `Chime meeting ${String(meeting.MeetingId)} in ${String(meeting.MediaRegion)}, attendee ${String(attendee.AttendeeId)}, ` +
        `signaling ${String(placement.SignalingUrl ?? '(none)')}, capabilities ${JSON.stringify(attendee.Capabilities ?? null)}`,
    );
  }

  /** Hangs up. `keepalive` is for page unload, so rooms.leave still reaches Slack. */
  async function leave({ keepalive = false }: { keepalive?: boolean } = {}): Promise<void> {
    const room = joinedRoom;
    attempt++;
    const session = media;
    media = null;
    joinedRoom = null;
    state.set(IDLE_CALL);
    try {
      await session?.stop();
    } catch (error) {
      log.add('warn', `stopping huddle audio failed: ${describeError(error)}`);
      console.warn(`[slick] [Better Huddles] stopping huddle audio failed: ${(error as Error).message}`);
    }
    if (room) await tellSlackWeLeft(room, keepalive ? 'unload' : 'user_initiated', keepalive);
  }

  /** Closes the "couldn't join" / "huddle ended" notice. */
  function dismiss(): void {
    if (state.get().status === 'failed') state.set(IDLE_CALL);
  }

  function toggleMute(): void {
    const current = state.get();
    if (current.status !== 'connected' || !media) return;
    media.setMuted(!current.muted);
    state.set({ ...current, muted: !current.muted });
  }

  /** Camera / screen share on↔off. Throws a user-readable error (permission denied, picker cancelled…). */
  async function toggleVideoSource(source: 'cameraOn' | 'screenSharing'): Promise<void> {
    const current = state.get();
    if (current.status !== 'connected' || !media) return;
    const enabled = !current[source];
    const thisAttempt = attempt;
    await (source === 'cameraOn' ? media.setCamera(enabled) : media.setScreenShare(enabled));
    if (thisAttempt === attempt) state.update((latest) => ({ ...latest, [source]: enabled }));
  }

  function updatePreferences(change: Partial<CallPreferences>): void {
    preferences.update((current) => ({ ...current, ...change }));
    savePreferences(preferences.get());
  }

  async function selectAudioDevice(kind: 'input' | 'output', deviceId: string): Promise<void> {
    const session = media;
    const thisAttempt = attempt;
    if (state.get().status !== 'connected' || !session) return;
    await (kind === 'input' ? session.setAudioInput(deviceId) : session.setAudioOutput(deviceId));
    if (thisAttempt === attempt)
      updatePreferences(kind === 'input' ? { audioInputId: deviceId } : { audioOutputId: deviceId });
  }

  /** Shader on↔off. Throws ShaderCompileError (or a camera error, for shaders that read it). */
  async function toggleShader(): Promise<void> {
    const current = state.get();
    if (current.status !== 'connected' || !media) return;
    const enabled = !current.shaderOn;
    const thisAttempt = attempt;
    await media.setShader(enabled ? preferences.get().shaderSource : null);
    if (thisAttempt === attempt) state.update((latest) => ({ ...latest, shaderOn: enabled }));
  }

  /** Saves new shader code, and sends it straight away if the shader is on. */
  async function setShaderSource(source: string): Promise<void> {
    if (state.get().shaderOn && media) await media.setShader(source);
    updatePreferences({ shaderSource: source });
  }

  return {
    state,
    /** Shader code, kept across calls. */
    preferences,
    /** This attempt's log, for the call window's "Copy logs". */
    log,
    join,
    leave,
    dismiss,
    toggleMute,
    selectAudioInput: (deviceId: string) => selectAudioDevice('input', deviceId),
    selectAudioOutput: (deviceId: string) => selectAudioDevice('output', deviceId),
    setAudioPreferences: (devices: Pick<CallPreferences, 'audioInputId' | 'audioOutputId'>) =>
      updatePreferences(devices),
    toggleCamera: () => toggleVideoSource('cameraOn'),
    toggleScreenShare: () => toggleVideoSource('screenSharing'),
    toggleShader,
    setShaderSource,
    /** Attaches a <video> to a tile from `state.tiles`; call `unbindTile` when the element goes away. */
    bindTile: (tileId: number, element: HTMLVideoElement) => media?.bindTile(tileId, element),
    unbindTile: (tileId: number) => media?.unbindTile(tileId),
    setVideoDisplayHeight: (cssPixels: number) => media?.setVideoDisplayHeight(cssPixels),
  };
}

export type HuddleCall = ReturnType<typeof createHuddleCall>;
