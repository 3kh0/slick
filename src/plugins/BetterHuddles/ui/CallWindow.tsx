// The huddle window, on top of the Slack page you're on: a floating window you
// can drag by its header and resize from any side or corner, the whole page, or
// a small audio-only bar. Header (where, who, how long), the stage, the controls,
// and the settings panel.

import type { CallLog } from '../callLog.ts';
import { CallLogPanel } from './CallLogPanel.tsx';
import { formatHuddleDuration, peopleCountLabel } from './callText.ts';
import { useCallState, useHuddleUi } from './context.ts';
import { CompactControls, Controls } from './Controls.tsx';
import { Icon, type IconName } from './icons.tsx';
import { SettingsPanel } from './SettingsPanel.tsx';
import { Stage } from './Stage.tsx';
import { useFullscreen } from './useFullscreen.ts';
import {
  moveWindowRect,
  parseWindowRect,
  RESIZE_EDGES,
  resizeWindowFromEdge,
  type ResizeEdge,
  type Viewport,
  type WindowRect,
} from './windowRect.ts';

const RECT_STORAGE_KEY = 'slick-better-huddles:window';
const DURATION_TICK_MS = 15_000;
const NOTICE_MS = 6_000;

const viewport = (): Viewport => ({ width: window.innerWidth, height: window.innerHeight });

function loadRect(): WindowRect {
  try {
    return parseWindowRect(JSON.parse(localStorage.getItem(RECT_STORAGE_KEY) ?? 'null'), viewport());
  } catch {
    return parseWindowRect(null, viewport());
  }
}

function saveRect(rect: WindowRect): void {
  try {
    localStorage.setItem(RECT_STORAGE_KEY, JSON.stringify(rect));
  } catch (error) {
    // Losing the remembered position only means the next call opens in the default spot.
    console.warn(`[slick] [Better Huddles] couldn't remember the window position: ${(error as Error).message}`);
  }
}

/** The window's rect, kept on screen when the page resizes, plus pointer handlers for move / resize. */
function useWindowRect() {
  const [rect, setRect] = React.useState(loadRect);
  const rectRef = React.useRef(rect);
  rectRef.current = rect;

  React.useEffect(() => {
    const keepOnScreen = () => setRect((current) => moveWindowRect(current, 0, 0, viewport()));
    window.addEventListener('resize', keepOnScreen);
    return () => window.removeEventListener('resize', keepOnScreen);
  }, []);

  const dragWith = (change: typeof moveWindowRect) => (event: React.PointerEvent<HTMLElement>) => {
    // Buttons in the header still click normally.
    if (event.button !== 0 || (event.target as Element).closest('button')) return;
    event.preventDefault();
    const start = { x: event.clientX, y: event.clientY, rect: rectRef.current };
    const target = event.currentTarget;
    target.setPointerCapture(event.pointerId);
    const onMove = (move: PointerEvent) =>
      setRect(change(start.rect, move.clientX - start.x, move.clientY - start.y, viewport()));
    const onUp = () => {
      target.removeEventListener('pointermove', onMove);
      target.removeEventListener('pointerup', onUp);
      target.removeEventListener('pointercancel', onUp);
      saveRect(rectRef.current);
    };
    target.addEventListener('pointermove', onMove);
    target.addEventListener('pointerup', onUp);
    target.addEventListener('pointercancel', onUp);
  };

  const onResizeStart = (edge: ResizeEdge) =>
    dragWith((start, deltaX, deltaY, size) => resizeWindowFromEdge(start, edge, deltaX, deltaY, size));
  return { rect, onMoveStart: dragWith(moveWindowRect), onResizeStart };
}

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

interface HeaderButtonProps {
  icon: IconName;
  label: string;
  onClick: () => void;
}

function HeaderButton({ icon, label, onClick }: HeaderButtonProps) {
  return (
    <button type="button" className="sbh-icon-button" onClick={onClick} aria-label={label} title={label}>
      <Icon name={icon} size={16} />
    </button>
  );
}

interface WindowHeaderProps {
  onPointerDown?: (event: React.PointerEvent<HTMLElement>) => void;
  children?: React.ReactNode;
}

/** Where + who + how long; also the drag handle. `children` are its buttons. */
function WindowHeader({ onPointerDown, children }: WindowHeaderProps) {
  const { conversationLabel } = useHuddleUi();
  const state = useCallState();
  return (
    <header className="sbh-header" onPointerDown={onPointerDown}>
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

function ResizeHandles({
  onResizeStart,
}: {
  onResizeStart: (edge: ResizeEdge) => (event: React.PointerEvent<HTMLElement>) => void;
}) {
  return RESIZE_EDGES.map((edge) => (
    <div
      key={edge}
      className={`sbh-resize sbh-resize--${edge}`}
      onPointerDown={onResizeStart(edge)}
      aria-hidden="true"
    />
  ));
}

/** Collapsed: stay in the call with no video on screen, just mute / leave. */
function CallBar({
  rect,
  onMoveStart,
  onExpand,
}: {
  rect: WindowRect;
  onMoveStart: WindowHeaderProps['onPointerDown'];
  onExpand: () => void;
}) {
  const { conversationLabel } = useHuddleUi();
  const state = useCallState();
  return (
    <section
      className="sbh-window sbh-window--bar"
      style={{ left: rect.left, top: rect.top }}
      aria-label={`Huddle in ${conversationLabel(state.channelId)}`}
    >
      <WindowHeader onPointerDown={onMoveStart}>
        <HeaderButton icon="chevron-up" label="Show video" onClick={onExpand} />
      </WindowHeader>
      <CompactControls />
    </section>
  );
}

export function CallWindow() {
  const { call, conversationLabel, initialLayout } = useHuddleUi();
  const state = useCallState();
  const [filled, setFilled] = React.useState(() => initialLayout() === 'page');
  const [collapsed, setCollapsed] = React.useState(false);
  const [settingsOpen, setSettingsOpen] = React.useState(false);
  // Once opened, the panel stays mounted (just hidden) so unapplied shader edits survive closing it.
  const [settingsMounted, setSettingsMounted] = React.useState(false);
  const { rect, onMoveStart, onResizeStart } = useWindowRect();
  const { notice, report } = useNotice(call.log);
  const windowRef = React.useRef<HTMLElement>(null);
  const { fullscreen, toggle: toggleFullscreen } = useFullscreen(windowRef);
  const floating = !filled && !fullscreen;

  if (collapsed && state.status !== 'failed')
    return <CallBar rect={rect} onMoveStart={onMoveStart} onExpand={() => setCollapsed(false)} />;

  const placement: React.CSSProperties = filled
    ? {}
    : { left: rect.left, top: rect.top, width: rect.width, height: rect.height };
  return (
    <section
      ref={windowRef}
      className={filled ? 'sbh-window sbh-window--filled' : 'sbh-window'}
      style={placement}
      aria-label={`Huddle in ${conversationLabel(state.channelId)}`}
    >
      <WindowHeader onPointerDown={floating ? onMoveStart : undefined}>
        {!fullscreen && (
          <HeaderButton
            icon="chevron-down"
            label="Hide video (stay in the huddle)"
            onClick={() => setCollapsed(true)}
          />
        )}
        {!fullscreen && (
          <HeaderButton
            icon={filled ? 'minimize-2' : 'maximize-2'}
            label={filled ? 'Shrink to a window' : 'Fill the page'}
            onClick={() => setFilled(!filled)}
          />
        )}
      </WindowHeader>
      <div className="sbh-body">
        {state.status === 'failed' ? (
          <CallFailure message={state.message} log={call.log} onClose={call.dismiss} />
        ) : (
          <Stage
            onControlError={report}
            onToggleSettings={() => {
              setSettingsMounted(true);
              setSettingsOpen(!settingsOpen);
            }}
          />
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
          <Controls onControlError={report} fullscreen={fullscreen} onToggleFullscreen={toggleFullscreen} />
        </footer>
      )}
      {floating && <ResizeHandles onResizeStart={onResizeStart} />}
    </section>
  );
}

/** Root of the plugin's React tree: nothing while you're not in (or joining) a huddle. */
export function CallApp() {
  const state = useCallState();
  return state.status === 'idle' ? null : <CallWindow />;
}
