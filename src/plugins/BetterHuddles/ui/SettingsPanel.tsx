// The call window's settings (gear button): the video-effect shader editor.
// Slides over the stage so the main controls stay simple.

import { Icon } from './icons.tsx';
import { ShaderEditor } from './ShaderEditor.tsx';

interface SettingsPanelProps {
  hidden: boolean;
  onClose: () => void;
  onControlError: (prefix: string, error: unknown) => void;
}

export function SettingsPanel({ hidden, onClose, onControlError }: SettingsPanelProps) {
  return (
    <aside
      className="sbh-settings"
      hidden={hidden}
      aria-label="Video effect settings"
      // Keys typed here (shader code) mustn't reach Slack's own keyboard shortcuts.
      onKeyDown={(event) => {
        event.stopPropagation();
        if (event.key === 'Escape') onClose();
      }}
    >
      <div className="sbh-settings-row">
        <h2>Video effect</h2>
        <button type="button" className="sbh-icon-button" onClick={onClose} aria-label="Close settings" title="Close">
          <Icon name="x" size={16} />
        </button>
      </div>
      <ShaderEditor onControlError={onControlError} />
    </aside>
  );
}
