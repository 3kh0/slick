import {
  DefaultBrowserBehavior,
  DefaultDeviceController,
  DefaultEventController,
  DefaultMeetingSession,
  MeetingSessionConfiguration,
  MeetingSessionStatusCode,
  NoOpEventReporter,
  VideoPriorityBasedPolicy,
  VideoCodecCapability,
  VideoPriorityBasedPolicyConfig,
  type AudioVideoFacade,
  type AudioVideoObserver,
  type MeetingSessionStatus,
} from './chimeSdk.ts';
import { createChimeVideoControls } from './chimeVideo.ts';
import { createAudioDeviceControls } from './audioDevices.ts';
import { withoutEventIngestion } from './noTelemetry.ts';
import { createRecordingLogger } from './recordingLogger.ts';
import { browserFamily, uplinkVideoPlan, type SendCodec } from './videoQuality.ts';
import {
  createParticipantTracker,
  createSpeakingTracker,
  slackUserIdFromExternalId,
  type MediaSession,
  type MediaSessionOptions,
} from './mediaSession.ts';

/**
 * Huddle session on the stock AWS Chime SDK, the same way third-party huddle
 * clients do it: mic in, everyone
 * else's mixed audio out, volume indicators for "who's talking". Camera, screen
 * share and incoming video live in chimeVideo.ts.
 */

const CONNECT_TIMEOUT_MS = 20_000;

function describeStatus(status: MeetingSessionStatus): string {
  const code = status.statusCode();
  if (code === MeetingSessionStatusCode.MeetingEnded || code === MeetingSessionStatusCode.TURNCredentialsForbidden)
    return 'The huddle ended.';
  if (code === MeetingSessionStatusCode.AudioAttendeeRemoved) return 'You were removed from the huddle.';
  if (code === MeetingSessionStatusCode.AudioAuthenticationRejected)
    return "The huddle's audio server rejected Slack's credentials. Try joining again.";
  if (code === MeetingSessionStatusCode.AudioJoinedFromAnotherDevice)
    return 'You joined this huddle from another device.';
  if (code === MeetingSessionStatusCode.Left) return 'You left the huddle.';
  return `The huddle connection dropped (Chime status ${MeetingSessionStatusCode[code] ?? code}).`;
}

/**
 * Maps Chime attendees to Slack users as they come and go, feeding their
 * volume into the speaking tracker. Our own attendee id is known up front, so
 * your indicator works even if Slack's ExternalUserId format can't be parsed.
 */
function watchSpeakers(audioVideo: AudioVideoFacade, options: MediaSessionOptions, localAttendeeId: string): void {
  const tracker = createSpeakingTracker(options.callbacks.onSpeaking, options.callbacks.onMutedChanged);
  const participants = createParticipantTracker(options.callbacks.onParticipantsChanged);
  const userByAttendee = new Map<string, string>();
  audioVideo.realtimeSubscribeToAttendeeIdPresence((attendeeId, present, externalUserId) => {
    const userId = attendeeId === localAttendeeId ? options.localUserId : slackUserIdFromExternalId(externalUserId);
    if (!userId) return;
    participants.update(attendeeId, userId, present);
    if (!present) {
      audioVideo.realtimeUnsubscribeFromVolumeIndicator(attendeeId);
      userByAttendee.delete(attendeeId);
      tracker.remove(userId);
      return;
    }
    if (userByAttendee.has(attendeeId)) return;
    userByAttendee.set(attendeeId, userId);
    audioVideo.realtimeSubscribeToVolumeIndicator(attendeeId, (_id, volume, muted) =>
      tracker.update(userId, volume, muted),
    );
  });
}

/** Resolves when Chime reports audio started; rejects if it stops first or takes too long. */
function waitForStart(audioVideo: AudioVideoFacade, onEndedAfterStart: (reason: string) => void): Promise<void> {
  return new Promise((resolve, reject) => {
    let started = false;
    const timer = setTimeout(
      () =>
        reject(
          new Error(
            `Couldn't reach the huddle's audio server within ${CONNECT_TIMEOUT_MS / 1000}s. Check your network or firewall.`,
          ),
        ),
      CONNECT_TIMEOUT_MS,
    );
    const observer: AudioVideoObserver = {
      audioVideoDidStart: () => {
        started = true;
        clearTimeout(timer);
        resolve();
      },
      audioVideoDidStop: (status) => {
        clearTimeout(timer);
        if (started) onEndedAfterStart(describeStatus(status));
        else reject(new Error(describeStatus(status)));
      },
    };
    audioVideo.addObserver(observer);
  });
}

function toCodecCapability(codec: SendCodec): VideoCodecCapability {
  return codec === 'vp8' ? VideoCodecCapability.vp8() : VideoCodecCapability.h264ConstrainedBaselineProfile();
}

export async function createChimeMediaSession(options: MediaSessionOptions): Promise<MediaSession> {
  const logger = createRecordingLogger(options.log ?? (() => {}));
  const configuration = new MeetingSessionConfiguration(
    { Meeting: withoutEventIngestion(options.credentials.meeting) },
    { Attendee: options.credentials.attendee },
  );
  // No meeting-event reports to Amazon (see noTelemetry.ts): no ingestion URL, and a reporter that drops everything.
  configuration.urls!.eventIngestionURL = null;
  const eventController = new DefaultEventController(configuration, logger, new NoOpEventReporter());
  // Not Chime's default (AllHighest), which never backs off and lets video lag grow on a busy connection; see videoQuality.ts.
  const downlinkPolicy = new VideoPriorityBasedPolicy(logger, VideoPriorityBasedPolicyConfig.Default);
  configuration.videoDownlinkBandwidthPolicy = downlinkPolicy;
  const browser = new DefaultBrowserBehavior();
  const uplink = uplinkVideoPlan(browserFamily(browser.hasChromiumWebRTC(), browser.name()));
  configuration.enableSimulcastForUnifiedPlanChromiumBasedBrowsers = uplink.simulcast;
  const session = new DefaultMeetingSession(
    configuration,
    logger,
    new DefaultDeviceController(logger),
    eventController,
  );
  const audioVideo = session.audioVideo;
  const localAttendeeId = configuration.credentials?.attendeeId ?? '';
  const speakerOutput = new Audio();
  speakerOutput.autoplay = true;
  // Before start(), so tiles for people already sharing video aren't missed.
  if (uplink.codecs) {
    const codecs = uplink.codecs.map(toCodecCapability);
    audioVideo.setVideoCodecSendPreferences?.(codecs);
    audioVideo.setContentShareVideoCodecPreferences?.(codecs);
  }
  const video = createChimeVideoControls(audioVideo, options, downlinkPolicy, {
    ...uplink.capture,
    ...(options.cameraInputId ? { deviceId: { exact: options.cameraInputId } } : {}),
  });

  let stopped = false;
  const audio = createAudioDeviceControls(audioVideo, speakerOutput, () => stopped);
  async function stop(): Promise<void> {
    if (stopped) return;
    stopped = true;
    // Video teardown failing (e.g. a camera that already vanished) mustn't leave the call's audio running.
    await video.stop().catch((error: Error) => console.warn(`Stopping huddle video failed: ${error.message}`));
    audioVideo.stop();
    await audioVideo.stopAudioInput();
    audioVideo.unbindAudioElement();
  }

  try {
    const devices = await navigator.mediaDevices.enumerateDevices();
    const available = (kind: MediaDeviceKind, id?: string) =>
      devices.some((device) => device.kind === kind && device.deviceId === id) ? id! : 'default';
    await audio.setAudioInput(available('audioinput', options.audioInputId));
    await audioVideo.bindAudioElement(speakerOutput);
    await audio.setAudioOutput(available('audiooutput', options.audioOutputId));
    watchSpeakers(audioVideo, options, localAttendeeId);
    const started = waitForStart(audioVideo, (reason) => {
      void stop();
      options.callbacks.onEnded(reason);
    });
    // Muted before start() so not even the first packets of mic audio reach Chime.
    if (options.startMuted) audioVideo.realtimeMuteLocalAudio();
    audioVideo.start();
    await started;
    if (options.startMuted) audioVideo.realtimeMuteLocalAudio();
    else audioVideo.realtimeUnmuteLocalAudio();
  } catch (error) {
    await stop();
    throw error;
  }

  return {
    ...audio,
    setMuted: (muted) => (muted ? audioVideo.realtimeMuteLocalAudio() : audioVideo.realtimeUnmuteLocalAudio()),
    setCamera: video.setCamera,
    setShader: video.setShader,
    setScreenShare: video.setScreenShare,
    bindTile: video.bindTile,
    unbindTile: video.unbindTile,
    setVideoDisplayHeight: video.setVideoDisplayHeight,
    stop,
  };
}
