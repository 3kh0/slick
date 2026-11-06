import {
  VideoPreference,
  VideoPreferences,
  type AudioVideoFacade,
  type ContentShareObserver,
  type VideoPriorityBasedPolicy,
  type VideoTileState,
} from './chimeSdk.ts';
import {
  summarizeVideoStats,
  TARGET_DISPLAY_SIZE,
  targetSizeForHeight,
  videoPreferencesFor,
  type TargetDisplaySizeLevel,
} from './videoQuality.ts';
import { startShaderStream, type ShaderVideoSource } from './shaderVideo.ts';
import {
  createTileTracker,
  mediaDeviceError,
  slackUserIdFromExternalId,
  tileHasVideo,
  videoCapabilities,
  type MediaSession,
  type MediaSessionOptions,
} from './mediaSession.ts';

/**
 * Camera, screen share and incoming video for a Chime huddle session.
 * Remote video arrives as "tiles" (one per camera / screen share) that the UI
 * binds <video> elements to. Screen shares are Chime "content share", which
 * joins as a second attendee (`<attendee id>#content`) on the same credentials,
 * as hq-fishbowl does.
 */

export type ChimeVideoControls = Pick<
  MediaSession,
  'setCamera' | 'setShader' | 'setScreenShare' | 'bindTile' | 'unbindTile' | 'setVideoDisplayHeight'
> & {
  stop: () => Promise<void>;
};

const STATS_INTERVAL_MS = 5000;
// Set localStorage['slick-better-huddles:debug'] = '1' to log what the incoming video is doing (resolution, lag, loss).
const DEBUG_STORAGE_KEY = 'slick-better-huddles:debug';

/**
 * Tells Chime which senders to receive and at what resolution, re-choosing
 * whenever the senders or the on-screen tile size change.
 */
function steerDownlink(audioVideo: AudioVideoFacade, policy: VideoPriorityBasedPolicy) {
  let senders: string[] = [];
  let targetSize: TargetDisplaySizeLevel = TARGET_DISPLAY_SIZE.high;

  function choose(): void {
    const preferences = VideoPreferences.prepare();
    for (const spec of videoPreferencesFor(senders, targetSize))
      preferences.add(new VideoPreference(spec.attendeeId, spec.priority, spec.targetSize));
    policy.chooseRemoteVideoSources(preferences.build());
  }

  audioVideo.addObserver({
    remoteVideoSourcesDidChange: (sources) => {
      senders = sources.map((source) => source.attendee.attendeeId);
      choose();
    },
  });

  return (cssPixels: number) => {
    const next = targetSizeForHeight(cssPixels * (window.devicePixelRatio || 1));
    if (next === targetSize) return;
    targetSize = next;
    if (senders.length) choose();
  };
}

function isDebugEnabled(): boolean {
  try {
    return localStorage.getItem(DEBUG_STORAGE_KEY) === '1';
  } catch {
    return false;
  }
}

/** With the debug flag on, logs a summary of incoming video every few seconds. Returns a stop function. */
function startStatsLogging(audioVideo: AudioVideoFacade): () => void {
  if (!isDebugEnabled()) return () => {};
  const timer = setInterval(async () => {
    try {
      const report = await audioVideo.getRTCPeerConnectionStats();
      if (report) console.info('[huddle video]', summarizeVideoStats([...report.values()]));
    } catch (error) {
      console.warn(`Couldn't read huddle video stats: ${(error as Error).message}`);
    }
  }, STATS_INTERVAL_MS);
  return () => clearInterval(timer);
}

function tileOwner(state: VideoTileState, localUserId: string): string | null {
  // Our own screen share comes back as a remote content tile, so content tiles are always mapped by external id.
  if (state.localTile) return localUserId;
  return slackUserIdFromExternalId(state.boundExternalUserId ?? undefined);
}

/** Mirrors Chime's tile events into the tracker (tiles without a stream, e.g. a stopped camera, are hidden). */
function watchTiles(audioVideo: AudioVideoFacade, options: MediaSessionOptions) {
  const tracker = createTileTracker(options.callbacks.onTilesChanged);
  audioVideo.addObserver({
    videoTileDidUpdate: (state) => {
      if (state.tileId === null) return;
      if (!tileHasVideo(state)) return tracker.remove(state.tileId);
      tracker.upsert({
        tileId: state.tileId,
        userId: tileOwner(state, options.localUserId),
        isLocal: state.localTile,
        isContent: state.isContent,
      });
    },
    videoTileWasRemoved: (tileId) => tracker.remove(tileId),
  });
  return tracker;
}

/** What Chime is sending as your video; compared so an unchanged input isn't restarted. */
interface VideoInput {
  /** The shader's source, or null for the plain camera. */
  shader: string | null;
}

/** `cameraConstraints` comes from the browser's uplink plan (videoQuality.ts `uplinkVideoPlan`). */
export function createChimeVideoControls(
  audioVideo: AudioVideoFacade,
  options: MediaSessionOptions,
  downlinkPolicy: VideoPriorityBasedPolicy,
  cameraConstraints: MediaTrackConstraints,
): ChimeVideoControls {
  const tracker = watchTiles(audioVideo, options);
  const setVideoDisplayHeight = steerDownlink(audioVideo, downlinkPolicy);
  const stopStatsLogging = startStatsLogging(audioVideo);
  const capabilities = videoCapabilities(options.credentials.attendee);
  if (!capabilities.canReceive)
    console.warn("Slack's Chime attendee can't receive video (Capabilities.Video), so others' cameras won't show.");
  let cameraOn = false;
  let shaderSource: string | null = null;
  let sharing = false;
  // What's being sent right now (null = no video), and the shader drawing it, if any.
  let sending: VideoInput | null = null;
  let runningShader: ShaderVideoSource | null = null;

  const contentObserver: ContentShareObserver = {
    contentShareDidStop: () => {
      if (!sharing) return;
      sharing = false;
      options.callbacks.onScreenShareEnded();
    },
  };
  audioVideo.addContentShareObserver(contentObserver);

  /** Video goes out while the camera or a shader is on; a shader replaces the camera. */
  function wantedInput(): VideoInput | null {
    if (!cameraOn && shaderSource === null) return null;
    return { shader: shaderSource };
  }

  async function stopSending(): Promise<void> {
    sending = null;
    audioVideo.stopLocalVideoTile();
    await audioVideo.stopVideoInput();
    runningShader?.stop();
    runningShader = null;
  }

  /** Starts or swaps Chime's video input to match `wantedInput()`; on failure the old input keeps going. */
  async function applyVideoInput(): Promise<void> {
    const wanted = wantedInput();
    const unchanged = wanted === null ? sending === null : sending !== null && sending.shader === wanted.shader;
    if (unchanged) return;
    if (!wanted) return stopSending();
    if (!capabilities.canSend) throw new Error("Slack didn't allow this huddle session to send video.");
    const nextShader = wanted.shader === null ? null : await startShaderStream(wanted.shader, cameraConstraints);
    try {
      await audioVideo.startVideoInput(nextShader ? nextShader.stream : cameraConstraints);
    } catch (error) {
      nextShader?.stop();
      throw mediaDeviceError('camera', error);
    }
    // Chime already stopped the old input's track; this stops the old shader's animation and camera.
    runningShader?.stop();
    runningShader = nextShader;
    const wasSending = sending !== null;
    sending = wanted;
    if (!wasSending) audioVideo.startLocalVideoTile();
  }

  /** Changes one wish, applies it, and puts the wish back if the video couldn't follow. */
  async function changeInput(change: () => () => void): Promise<void> {
    const undo = change();
    try {
      await applyVideoInput();
    } catch (error) {
      undo();
      throw error;
    }
  }

  const setCamera = (enabled: boolean) =>
    changeInput(() => {
      const previous = cameraOn;
      cameraOn = enabled;
      return () => (cameraOn = previous);
    });

  const setShader = (source: string | null) =>
    changeInput(() => {
      const previous = shaderSource;
      shaderSource = source;
      return () => (shaderSource = previous);
    });

  async function setScreenShare(enabled: boolean): Promise<void> {
    if (enabled === sharing) return;
    if (!enabled) {
      sharing = false;
      audioVideo.stopContentShare();
      return;
    }
    try {
      await audioVideo.startContentShareFromScreenCapture();
    } catch (error) {
      throw mediaDeviceError('screen', error);
    }
    sharing = true;
  }

  return {
    setCamera,
    setShader,
    setScreenShare,
    bindTile: (tileId, element) => audioVideo.bindVideoElement(tileId, element),
    unbindTile: (tileId) => audioVideo.unbindVideoElement(tileId, false),
    setVideoDisplayHeight,
    async stop() {
      stopStatsLogging();
      if (sharing) await setScreenShare(false);
      if (sending) await stopSending();
      audioVideo.removeContentShareObserver(contentObserver);
      tracker.clear();
    },
  };
}
