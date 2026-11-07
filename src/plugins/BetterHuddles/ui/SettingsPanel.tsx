// Audio devices and video effects, alongside the call stage.

import { useHuddleUi } from './context.ts';
import { Icon } from './icons.tsx';
import { ShaderEditor } from './ShaderEditor.tsx';
import { AudioSettings } from './AudioSettings.tsx';

interface SettingsPanelProps {
  hidden: boolean;
  onClose: () => void;
  onControlError: (prefix: string, error: unknown) => void;
}

export function SettingsPanel({ hidden, onClose, onControlError }: SettingsPanelProps) {
  const { useParticipantSide, setParticipantSide } = useHuddleUi();
  const participantSide = useParticipantSide();
  return (
    <aside
      className="sbh-settings"
      hidden={hidden}
      aria-label="Huddle settings"
      // Keys typed here (shader code) mustn't reach Slack's own keyboard shortcuts.
      onKeyDown={(event) => {
        event.stopPropagation();
        if (event.key === 'Escape') onClose();
      }}
    >
      <div className="sbh-settings-row">
        <h2>Huddle settings</h2>
        <button type="button" className="sbh-icon-button" onClick={onClose} aria-label="Close settings" title="Close">
          <Icon name="x" size={16} />
        </button>
      </div>
      <label className="sbh-settings-section">
        <span>Participants beside screen shares</span>
        <select
          className="sbh-select"
          value={participantSide}
          onChange={(event) => setParticipantSide(event.target.value as 'left' | 'right')}
        >
          <option value="left">Left</option>
          <option value="right">Right</option>
        </select>
      </label>
      <AudioSettings onControlError={onControlError} />
      <h3>Video effect</h3>
      <ShaderEditor onControlError={onControlError} />
    </aside>
  );
}
