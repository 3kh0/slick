import type { CallLog } from '../callLog.ts';
import { CallLogPanel } from './CallLogPanel.tsx';
import { formatHuddleDuration, peopleCountLabel } from './callText.ts';
import { useCallState, useHuddleUi } from './context.ts';
import { CompactControls, Controls } from './Controls.tsx';
import { Icon } from './icons.tsx';
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

const viewport = (view: Window): Viewport => ({ width: view.innerWidth, height: view.innerHeight });

function loadRect(view: Window): WindowRect {
  try {
    return parseWindowRect(JSON.parse(localStorage.getItem(RECT_STORAGE_KEY) ?? 'null'), viewport(view));
  } catch {
    return parseWindowRect(null, viewport(view));
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
function useWindowRect(view: Window, targetRef: React.RefObject<HTMLElement | null>, compact: boolean) {
  const [rect, setRect] = React.useState(() => loadRect(view));
  const rectRef = React.useRef(rect);
  rectRef.current = rect;

  React.useEffect(() => {
    const keepOnScreen = () => setRect((current) => moveWindowRect(current, 0, 0, viewport(view)));
    view.addEventListener('resize', keepOnScreen);
    return () => view.removeEventListener('resize', keepOnScreen);
  }, [view]);

  React.useLayoutEffect(() => {
    if (!compact) return;
    const fit = () => {
      const bounds = targetRef.current?.getBoundingClientRect();
      if (!bounds) return;
      setRect((current) => {
        const left = Math.max(8, Math.min(current.left, view.innerWidth - bounds.width - 8));
        const top = Math.max(8, Math.min(current.top, view.innerHeight - bounds.height - 8));
        return left === current.left && top === current.top ? current : { ...current, left, top };
      });
    };
    fit();
    view.addEventListener('resize', fit);
    return () => view.removeEventListener('resize', fit);
  }, [compact, view, targetRef, rect.left, rect.top, rect.width, rect.height]);

  const dragWith = (change: typeof moveWindowRect) => (event: React.PointerEvent<HTMLElement>) => {
    // Buttons in the header still click normally.
    if (event.button !== 0 || (event.target as Element).closest('button,select')) return;
    event.preventDefault();
    const start = { x: event.clientX, y: event.clientY, rect: rectRef.current };
    const target = event.currentTarget;
    target.setPointerCapture(event.pointerId);
    const onMove = (move: PointerEvent) =>
      setRect(change(start.rect, move.clientX - start.x, move.clientY - start.y, viewport(view)));
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
  onPointerDown?: (event: React.PointerEvent<HTMLElement>) => void;
  children?: React.ReactNode;
}

function WindowHeader({ children, onPointerDown }: WindowHeaderProps) {
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

function InlineLayoutSelect() {
  const { useInlineLayout, setInlineLayout } = useHuddleUi();
  const layout = useInlineLayout();
  return (
    <select
      className="sbh-layout-select"
      aria-label="Layout inside Slack"
      value={layout}
      onPointerDown={(event) => event.stopPropagation()}
      onChange={(event) => setInlineLayout(event.currentTarget.value as 'page' | 'window' | 'minimized')}
    >
      <option value="page">Fill Slack</option>
      <option value="window">Floating panel</option>
      <option value="minimized">Minimized bar</option>
    </select>
  );
}

export function CallWindow() {
  const { call, conversationLabel, document: uiDocument, detached, useInlineLayout, setInlineLayout } = useHuddleUi();
  const inlineLayout = useInlineLayout();
  const layout = detached ? 'page' : inlineLayout;
  const expandedLayout = React.useRef<'page' | 'window'>('window');
  if (layout !== 'minimized') expandedLayout.current = layout;
  const state = useCallState();
  const windowRef = React.useRef<HTMLElement>(null);
  const { rect, onMoveStart, onResizeStart } = useWindowRect(
    uiDocument.defaultView!,
    windowRef,
    layout === 'minimized' && state.status !== 'failed',
  );
  const [settingsOpen, setSettingsOpen] = React.useState(false);
  // Once opened, the panel stays mounted (just hidden) so unapplied shader edits survive closing it.
  const [settingsMounted, setSettingsMounted] = React.useState(false);
  const { notice, report } = useNotice(call.log);
  const { fullscreen, toggle: toggleFullscreen } = useFullscreen(windowRef);
  React.useEffect(() => {
    if (layout === 'minimized') call.setVideoDisplayHeight(0);
  }, [call, layout, state.status]);
  const toggleSettings = () => {
    setSettingsMounted(true);
    setSettingsOpen(!settingsOpen);
  };

  if (layout === 'minimized' && state.status !== 'failed')
    return (
      <section
        ref={windowRef}
        className="sbh-window sbh-window--bar"
        style={{ left: rect.left, top: rect.top }}
        aria-label={`Huddle in ${conversationLabel(state.channelId)}`}
      >
        <WindowHeader onPointerDown={onMoveStart}>
          <button
            type="button"
            className="sbh-window-switch"
            onClick={() => setInlineLayout(expandedLayout.current)}
            aria-label="Restore huddle"
          >
            Restore
          </button>
          <PresentationButton />
        </WindowHeader>
        <CompactControls onControlError={report} />
      </section>
    );
  const floating = layout !== 'page' && !fullscreen;
  return (
    <section
      ref={windowRef}
      className={floating ? 'sbh-window' : 'sbh-window sbh-window--filled'}
      style={floating ? { left: rect.left, top: rect.top, width: rect.width, height: rect.height } : {}}
      aria-label={`Huddle in ${conversationLabel(state.channelId)}`}
    >
      <WindowHeader onPointerDown={floating ? onMoveStart : undefined}>
        {!fullscreen && (
          <>
            {!detached && <InlineLayoutSelect />}
            <PresentationButton />
          </>
        )}
      </WindowHeader>
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
      {floating && <ResizeHandles onResizeStart={onResizeStart} />}
    </section>
  );
}

/** Root of the plugin's React tree: nothing while you're not in (or joining) a huddle. */
export function CallApp() {
  const state = useCallState();
  return state.status === 'idle' ? null : <CallWindow />;
}
