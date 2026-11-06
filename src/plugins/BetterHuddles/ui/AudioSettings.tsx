import { useCallState, useHuddleUi, usePreferences } from './context.ts';

export function AudioSettings({ onControlError }: { onControlError: (prefix: string, error: unknown) => void }) {
  const { call } = useHuddleUi();
  const state = useCallState();
  const preferences = usePreferences();
  const [devices, setDevices] = React.useState<MediaDeviceInfo[]>([]);
  const [busy, setBusy] = React.useState(false);

  React.useEffect(() => {
    let active = true;
    const refresh = () => {
      navigator.mediaDevices.enumerateDevices().then(
        (next) => active && setDevices(next),
        (error) => active && onControlError("Couldn't list audio devices", error),
      );
    };
    refresh();
    navigator.mediaDevices.addEventListener('devicechange', refresh);
    return () => {
      active = false;
      navigator.mediaDevices.removeEventListener('devicechange', refresh);
    };
  }, [onControlError]);

  const choose = async (kind: 'audioinput' | 'audiooutput', deviceId: string) => {
    setBusy(true);
    try {
      await (kind === 'audioinput' ? call.selectAudioInput(deviceId) : call.selectAudioOutput(deviceId));
    } catch (error) {
      onControlError(kind === 'audioinput' ? "Couldn't change the microphone" : "Couldn't change the speaker", error);
    } finally {
      setBusy(false);
    }
  };

  const select = (kind: 'audioinput' | 'audiooutput', label: string, selected = 'default') => {
    const choices = devices.filter((device) => device.kind === kind && device.deviceId !== 'default');
    const available = choices.some((device) => device.deviceId === selected);
    const supported = kind === 'audioinput' || 'setSinkId' in HTMLMediaElement.prototype;
    return (
      <label className="sbh-audio-device">
        <span>{label}</span>
        <select
          className="sbh-select"
          aria-label={label}
          value={available ? selected : 'default'}
          disabled={busy || state.status !== 'connected' || !supported}
          onChange={(event) => void choose(kind, event.currentTarget.value)}
        >
          <option value="default">System default</option>
          {choices.map((device, index) => (
            <option key={device.deviceId} value={device.deviceId}>
              {device.label || `${label} ${index + 1}`}
            </option>
          ))}
        </select>
        {!supported && <span className="sbh-hint">This browser uses the system speaker.</span>}
      </label>
    );
  };

  return (
    <section className="sbh-settings-section" aria-label="Audio devices">
      <h3>Audio</h3>
      <div className="sbh-audio-devices">
        {select('audioinput', 'Microphone', preferences.audioInputId)}
        {select('audiooutput', 'Speaker', preferences.audioOutputId)}
      </div>
    </section>
  );
}
