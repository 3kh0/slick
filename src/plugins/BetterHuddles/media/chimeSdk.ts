// The parts of the Chime SDK a huddle call needs, imported file by file. The
// package's index also loads its messaging client and the AWS SDK credential
// providers, which don't belong on the Slack page: the SDK is only here to talk
// to Slack's huddle media servers.
//
// The SDK's build/ files are CommonJS (`exports.default = Class`). Slick's package
// is `"type": "module"`, so esbuild (like Node) hands over the whole
// `module.exports` as the default import; `cjsDefault` picks the class out of it.
// tests/media/chimeSdkBundle.test.ts checks this against a real bundle.

import { cjsDefault } from './cjsDefault.ts';

import DefaultBrowserBehaviorModule from 'amazon-chime-sdk-js/build/browserbehavior/DefaultBrowserBehavior.js';
import DefaultDeviceControllerModule from 'amazon-chime-sdk-js/build/devicecontroller/DefaultDeviceController.js';
import DefaultEventControllerModule from 'amazon-chime-sdk-js/build/eventcontroller/DefaultEventController.js';
import NoOpEventReporterModule from 'amazon-chime-sdk-js/build/eventreporter/NoOpEventReporter.js';
import DefaultMeetingSessionModule from 'amazon-chime-sdk-js/build/meetingsession/DefaultMeetingSession.js';
import MeetingSessionConfigurationModule from 'amazon-chime-sdk-js/build/meetingsession/MeetingSessionConfiguration.js';
import MeetingSessionStatusCodeModule from 'amazon-chime-sdk-js/build/meetingsession/MeetingSessionStatusCode.js';
import VideoCodecCapabilityModule from 'amazon-chime-sdk-js/build/sdp/VideoCodecCapability.js';
import VideoPreferenceModule from 'amazon-chime-sdk-js/build/videodownlinkbandwidthpolicy/VideoPreference.js';
import VideoPriorityBasedPolicyModule from 'amazon-chime-sdk-js/build/videodownlinkbandwidthpolicy/VideoPriorityBasedPolicy.js';
import VideoPriorityBasedPolicyConfigModule from 'amazon-chime-sdk-js/build/videodownlinkbandwidthpolicy/VideoPriorityBasedPolicyConfig.js';

export const DefaultBrowserBehavior = cjsDefault(DefaultBrowserBehaviorModule);
export type DefaultBrowserBehavior = DefaultBrowserBehaviorModule;
export const DefaultDeviceController = cjsDefault(DefaultDeviceControllerModule);
export type DefaultDeviceController = DefaultDeviceControllerModule;
export const DefaultEventController = cjsDefault(DefaultEventControllerModule);
export type DefaultEventController = DefaultEventControllerModule;
export const NoOpEventReporter = cjsDefault(NoOpEventReporterModule);
export type NoOpEventReporter = NoOpEventReporterModule;
export const DefaultMeetingSession = cjsDefault(DefaultMeetingSessionModule);
export type DefaultMeetingSession = DefaultMeetingSessionModule;
export const MeetingSessionConfiguration = cjsDefault(MeetingSessionConfigurationModule);
export type MeetingSessionConfiguration = MeetingSessionConfigurationModule;
export const MeetingSessionStatusCode = cjsDefault(MeetingSessionStatusCodeModule);
export type MeetingSessionStatusCode = MeetingSessionStatusCodeModule;
export const VideoCodecCapability = cjsDefault(VideoCodecCapabilityModule);
export type VideoCodecCapability = VideoCodecCapabilityModule;
export const VideoPreference = cjsDefault(VideoPreferenceModule);
export type VideoPreference = VideoPreferenceModule;
export const VideoPriorityBasedPolicy = cjsDefault(VideoPriorityBasedPolicyModule);
export type VideoPriorityBasedPolicy = VideoPriorityBasedPolicyModule;
export const VideoPriorityBasedPolicyConfig = cjsDefault(VideoPriorityBasedPolicyConfigModule);
export type VideoPriorityBasedPolicyConfig = VideoPriorityBasedPolicyConfigModule;

// A named export: esbuild and Node both read it straight off `module.exports`.
export { VideoPreferences } from 'amazon-chime-sdk-js/build/videodownlinkbandwidthpolicy/VideoPreferences.js';
export type { default as AudioVideoFacade } from 'amazon-chime-sdk-js/build/audiovideofacade/AudioVideoFacade.js';
export type { default as AudioVideoObserver } from 'amazon-chime-sdk-js/build/audiovideoobserver/AudioVideoObserver.js';
export type { default as ContentShareObserver } from 'amazon-chime-sdk-js/build/contentshareobserver/ContentShareObserver.js';
export type { default as MeetingSessionStatus } from 'amazon-chime-sdk-js/build/meetingsession/MeetingSessionStatus.js';
export type { default as VideoTileState } from 'amazon-chime-sdk-js/build/videotile/VideoTileState.js';
