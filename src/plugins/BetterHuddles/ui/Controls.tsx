// Mute, camera, screen share, full screen and leave, for the huddle you're in.

import { useCallState, useHuddleUi } from './context.ts';
import { Icon, type IconName } from './icons.tsx';

type Tone = 'default' | 'active' | 'warning' | 'danger';

interface ControlButtonProps {
  label: string;
  icon: IconName;
  onClick: () => void;
  pressed?: boolean;
  tone?: Tone;
  disabled?: boolean;
}

/** A round call-control button; `tone="danger"` is the red hang-up button. */
export function ControlButton({
  label,
  icon,
  onClick,
  pressed,
  tone = 'default',
  disabled = false,
}: ControlButtonProps) {
  return (
    <button
      type="button"
      className={`sbh-control sbh-control--${tone}`}
      onClick={onClick}
      disabled={disabled}
      aria-pressed={pressed}
      aria-label={label}
      title={label}
    >
      <Icon name={icon} size={22} />
    </button>
  );
}

function MuteButton() {
  const { call } = useHuddleUi();
  const state = useCallState();
  return (
    <ControlButton
      label={state.muted ? 'Unmute microphone' : 'Mute microphone'}
      icon={state.muted ? 'mic-off' : 'mic'}
      pressed={state.muted}
      tone={state.muted ? 'warning' : 'default'}
      disabled={state.status !== 'connected'}
      onClick={call.toggleMute}
    />
  );
}

function LeaveButton() {
  const { call } = useHuddleUi();
  return <ControlButton label="Leave huddle" icon="phone-off" tone="danger" onClick={() => void call.leave()} />;
}

interface ControlsProps {
  onControlError: (prefix: string, error: unknown) => void;
  fullscreen: boolean;
  onToggleFullscreen: () => void;
  onToggleSettings: () => void;
}

export function Controls({ onControlError, fullscreen, onToggleFullscreen, onToggleSettings }: ControlsProps) {
  const { call } = useHuddleUi();
  const state = useCallState();
  const connected = state.status === 'connected';
  const run = (prefix: string, control: () => Promise<void>) => () =>
    control().catch((error) => onControlError(prefix, error));

  return (
    <div className="sbh-controls" role="toolbar" aria-label="Huddle controls">
      <MuteButton />
      <ControlButton
        label={state.cameraOn ? 'Turn camera off' : 'Turn camera on'}
        icon={state.cameraOn ? 'video' : 'video-off'}
        pressed={state.cameraOn}
        tone={state.cameraOn ? 'active' : 'default'}
        disabled={!connected}
        onClick={run("Couldn't change the camera", call.toggleCamera)}
      />
      <ControlButton
        label={state.screenSharing ? 'Stop sharing your screen' : 'Share your screen'}
        icon={state.screenSharing ? 'screen-share-off' : 'screen-share'}
        pressed={state.screenSharing}
        tone={state.screenSharing ? 'active' : 'default'}
        disabled={!connected}
        onClick={run("Couldn't change screen sharing", call.toggleScreenShare)}
      />
      <ControlButton
        label={fullscreen ? 'Exit full screen' : 'Full screen'}
        icon={fullscreen ? 'minimize' : 'maximize'}
        pressed={fullscreen}
        onClick={onToggleFullscreen}
      />
      <ControlButton label="Huddle settings" icon="settings" onClick={onToggleSettings} />
      <LeaveButton />
    </div>
  );
}
