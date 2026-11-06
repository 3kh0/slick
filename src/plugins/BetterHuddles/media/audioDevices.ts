import type { AudioVideoFacade } from './chimeSdk.ts';
import { mediaDeviceError } from './mediaSession.ts';

export function createAudioDeviceControls(
  audioVideo: AudioVideoFacade,
  output: HTMLAudioElement,
  isStopped: () => boolean,
  capture = (constraints: MediaStreamConstraints) => navigator.mediaDevices.getUserMedia(constraints),
) {
  return {
    async setAudioInput(deviceId: string) {
      if (isStopped()) return;
      let stream: MediaStream | undefined;
      try {
        stream = await capture({
          audio: {
            ...(deviceId === 'default' ? {} : { deviceId: { exact: deviceId } }),
            echoCancellation: true,
            noiseSuppression: true,
            autoGainControl: true,
          },
          video: false,
        });
        if (isStopped()) {
          for (const track of stream.getTracks()) track.stop();
          return;
        }
        if (audioVideo.realtimeIsLocalAudioMuted()) for (const track of stream.getAudioTracks()) track.enabled = false;
        await audioVideo.startAudioInput(stream);
        if (isStopped()) await audioVideo.stopAudioInput();
      } catch (error) {
        for (const track of stream?.getTracks() ?? []) track.stop();
        throw mediaDeviceError('microphone', error);
      }
    },
    async setAudioOutput(deviceId: string) {
      if (isStopped()) return;
      if (typeof output.setSinkId !== 'function') {
        if (deviceId === 'default') return;
        throw new Error('This browser uses the system speaker.');
      }
      const devices = await audioVideo.listAudioOutputDevices(true);
      if (isStopped()) return;
      if (deviceId !== 'default' && !devices.some((device) => device.deviceId === deviceId))
        throw new Error('This speaker is no longer connected.');
      await output.setSinkId(deviceId === 'default' ? '' : deviceId);
      await audioVideo.chooseAudioOutput(deviceId === 'default' ? null : deviceId);
    },
  };
}
