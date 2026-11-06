import type { CallLog } from '../callLog.ts';
import { CallLogPanel } from './CallLogPanel.tsx';
import { formatHuddleDuration, peopleCountLabel } from './callText.ts';
import { useCallState, useHuddleUi } from './context.ts';
import { Controls } from './Controls.tsx';
import { Icon } from './icons.tsx';
import { SettingsPanel } from './SettingsPanel.tsx';
import { Stage } from './Stage.tsx';
import { useFullscreen } from './useFullscreen.ts';

const DURATION_TICK_MS = 15_000;
const NOTICE_MS = 6_000;

function useNow(intervalMs: number, active: boolean): number {
  const [now, setNow] = React.useState(Date.now);
  React.useEffect(() => {
    if (!active) return;
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(timer);
  }, [intervalMs, active]);
  return now;
}

/** A control failure (camera blocked, picker cancelled…), shown briefly in the window and kept in the log. */
function useNotice(log: CallLog) {
  const [notice, setNotice] = React.useState('');
  React.useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(() => setNotice(''), NOTICE_MS);
    return () => clearTimeout(timer);
  }, [notice]);
  const report = React.useCallback(
    (prefix: string, error: unknown) => {
      const message = `${prefix}: ${(error as Error)?.message ?? String(error)}`;
      log.add('warn', message);
      setNotice(message);
    },
    [log],
  );
  return { notice, report };
}

function CallFailure({ message, log, onClose }: { message: string; log: CallLog; onClose: () => void }) {
  return (
    <div className="sbh-failure" role="alert">
      <p>{message}</p>
      <button type="button" className="sbh-text-button" onClick={onClose}>
        Close
      </button>
      <CallLogPanel log={log} />
    </div>
  );
}

function useCallMeta(): string {
  const state = useCallState();
  const now = useNow(DURATION_TICK_MS, state.status === 'connected');
  if (state.status === 'failed') return 'Not connected';
  if (state.status !== 'connected') return 'Connecting…';
  return `${peopleCountLabel(state.participants.length)} · ${formatHuddleDuration((now - state.connectedAt) / 1000)}`;
}

function PresentationButton() {
  const { detached, moveCall } = useHuddleUi();
  const label = detached ? 'Move into Slack' : 'Open in separate window';
  return (
    <button
      type="button"
      className="sbh-window-switch"
      onClick={() => moveCall(!detached)}
      aria-label={label}
      title={label}
    >
      <Icon name={detached ? 'minimize-2' : 'maximize-2'} size={16} />
      <span>{detached ? 'Move into Slack' : 'Pop out'}</span>
    </button>
  );
}

interface WindowHeaderProps {
  children?: React.ReactNode;
}

function WindowHeader({ children }: WindowHeaderProps) {
  const { conversationLabel } = useHuddleUi();
  const state = useCallState();
  return (
    <header className="sbh-header">
      <span className="sbh-where">
        <Icon name="headphones" size={18} />
        <span className="sbh-where-name">{conversationLabel(state.channelId)}</span>
      </span>
      <span className="sbh-header-end">
        <span className="sbh-meta">{useCallMeta()}</span>
        {children}
      </span>
    </header>
  );
}

export function CallWindow() {
  const { call, conversationLabel } = useHuddleUi();
  const state = useCallState();
  const [settingsOpen, setSettingsOpen] = React.useState(false);
  // Once opened, the panel stays mounted (just hidden) so unapplied shader edits survive closing it.
  const [settingsMounted, setSettingsMounted] = React.useState(false);
  const { notice, report } = useNotice(call.log);
  const windowRef = React.useRef<HTMLElement>(null);
  const { fullscreen, toggle: toggleFullscreen } = useFullscreen(windowRef);
  const toggleSettings = () => {
    setSettingsMounted(true);
    setSettingsOpen(!settingsOpen);
  };

  return (
    <section
      ref={windowRef}
      className="sbh-window sbh-window--filled"
      aria-label={`Huddle in ${conversationLabel(state.channelId)}`}
    >
      <WindowHeader>{!fullscreen && <PresentationButton />}</WindowHeader>
      <div className="sbh-body">
        {state.status === 'failed' ? (
          <CallFailure message={state.message} log={call.log} onClose={call.dismiss} />
        ) : (
          <Stage onControlError={report} onToggleSettings={toggleSettings} />
        )}
        {settingsMounted && state.status !== 'failed' && (
          <SettingsPanel hidden={!settingsOpen} onClose={() => setSettingsOpen(false)} onControlError={report} />
        )}
      </div>
      {state.status !== 'failed' && (
        <footer className="sbh-footer">
          {notice && (
            <p className="sbh-notice" role="status">
              {notice}
            </p>
          )}
          <Controls
            onControlError={report}
            fullscreen={fullscreen}
            onToggleFullscreen={toggleFullscreen}
            onToggleSettings={toggleSettings}
          />
        </footer>
      )}
    </section>
  );
}

/** Root of the plugin's React tree: nothing while you're not in (or joining) a huddle. */
export function CallApp() {
  const state = useCallState();
  return state.status === 'idle' ? null : <CallWindow />;
}
