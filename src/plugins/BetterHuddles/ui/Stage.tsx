import {
  buildStageEntries,
  DEFAULT_VIDEO_ASPECT_RATIO,
  fitGrid,
  PARTICIPANT_ASPECT_RATIO,
  stageSections,
  type StageEntry,
} from '../media/stageLayout.ts';
import { useCallState, useHuddleUi } from './context.ts';
import { StageTile } from './StageTile.tsx';

const TILE_GAP = 12;

function useElementSize(ref: React.RefObject<HTMLElement | null>) {
  const [size, setSize] = React.useState({ width: 0, height: 0 });
  React.useLayoutEffect(() => {
    const element = ref.current;
    const view = element?.ownerDocument.defaultView;
    if (!element || !view) return;
    // Pop-outs must observe outside the main window's resize hold.
    const observer = new view.ResizeObserver(([observed]) => {
      setSize({ width: observed.contentRect.width, height: observed.contentRect.height });
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, [ref]);
  return size;
}

interface TileRenderer {
  (entry: StageEntry, width: number, height: number): React.ReactNode;
}

interface StageProps {
  onControlError: (prefix: string, error: unknown) => void;
  /** Opens or closes the video-effect editor (the gear on your own tile). */
  onToggleSettings: () => void;
}

export function Stage({ onControlError, onToggleSettings }: StageProps) {
  const { call, useParticipantSide, useCompactNoVideo } = useHuddleUi();
  const participantSide = useParticipantSide();
  const compact = useCompactNoVideo();
  const [expandedKey, setExpandedKey] = React.useState<string | null>(null);
  const state = useCallState();
  const stageRef = React.useRef<HTMLDivElement>(null);
  const stageSize = useElementSize(stageRef);
  // Real stream shapes, learned from each <video> as it loads.
  const [videoRatios, setVideoRatios] = React.useState<Record<number, number>>({});

  // Chime reports you first; Slack's room list shows you last, after the people
  // already there. buildStageEntries appends the local user when they're missing from the list.
  const others = state.participants.filter((userId) => userId !== state.localUserId);
  const entries = state.status === 'connected' ? buildStageEntries(state.tiles, others, state.localUserId) : [];
  const { expanded, main, sidebar } = stageSections(entries, expandedKey);
  React.useEffect(() => {
    if (!expanded) setExpandedKey(null);
    else stageRef.current?.focus({ preventScroll: true });
  }, [expanded?.key]);
  const stacked = sidebar.length > 0 && stageSize.width < 640;
  const stripHeight = stacked ? Math.floor(Math.min(compact ? 120 : 160, stageSize.height * 0.25)) : 0;
  const sidebarWidth = sidebar.length ? Math.floor(Math.min(compact ? 200 : 280, stageSize.width * 0.24)) : 0;
  const mainWidth = Math.max(0, stageSize.width - (sidebar.length && !stacked ? sidebarWidth + TILE_GAP : 0));
  const mainHeight = Math.max(0, stageSize.height - (stacked ? stripHeight + TILE_GAP : 0));
  const ratioOf = (entry: StageEntry) =>
    entry.kind === 'video' ? (videoRatios[entry.tile.tileId] ?? DEFAULT_VIDEO_ASPECT_RATIO) : PARTICIPANT_ASPECT_RATIO;
  const rects = fitGrid(main.map(ratioOf), mainWidth - 1, mainHeight - 1, TILE_GAP);
  const sidebarTileWidth = Math.max(
    1,
    stacked ? Math.floor((stripHeight - 12) * PARTICIPANT_ASPECT_RATIO) : sidebarWidth - 12,
  );
  const sidebarSize = (entry: StageEntry) => {
    const height = stacked ? Math.max(1, stripHeight - 12) : Math.floor(sidebarTileWidth / ratioOf(entry));
    return { width: stacked ? Math.floor(height * ratioOf(entry)) : sidebarTileWidth, height };
  };
  const displayHeight = Math.max(
    0,
    ...rects.map((rect) => rect.height),
    ...sidebar.map((entry) => sidebarSize(entry).height),
  );

  // Only download as much resolution as the tiles show.
  React.useEffect(() => {
    call.setVideoDisplayHeight(entries.length ? displayHeight : 0);
  }, [call, entries.length, displayHeight]);
  // Hidden (the window collapsed to its bar): ask for the smallest video layer.
  React.useEffect(() => () => call.setVideoDisplayHeight(0), [call]);

  const isMuted = (userId: string | null) => {
    if (!userId) return false;
    return userId === state.localUserId ? state.muted : state.mutedUsers.has(userId);
  };
  const toggleShader = () =>
    call.toggleShader().catch((error: unknown) => onControlError("Couldn't switch your video effect", error));
  const renderTile: TileRenderer = (entry, width, height) => (
    <StageTile
      key={entry.key}
      entry={entry}
      width={width}
      height={height}
      speaking={Boolean(entry.userId && state.speaking.has(entry.userId))}
      muted={isMuted(entry.userId)}
      isYou={entry.userId === state.localUserId}
      shaderOn={state.shaderOn}
      expanded={entry.key === expanded?.key}
      onToggleExpanded={() => setExpandedKey((current) => (current === entry.key ? null : entry.key))}
      onRatio={(ratio) => {
        if (entry.kind !== 'video' || videoRatios[entry.tile.tileId] === ratio) return;
        setVideoRatios((current) => ({ ...current, [entry.tile.tileId]: ratio }));
      }}
      onToggleShader={toggleShader}
      onOpenSettings={onToggleSettings}
    />
  );

  return (
    <div
      className={`sbh-stage sbh-stage--${stacked ? 'stacked' : participantSide}`}
      ref={stageRef}
      tabIndex={-1}
      style={{ gap: TILE_GAP }}
      onKeyDown={(event) => {
        if (event.key === 'Escape' && expanded) {
          event.stopPropagation();
          setExpandedKey(null);
        }
      }}
    >
      {state.status === 'joining' && (
        <p className="sbh-stage-status" role="status">
          Connecting…
        </p>
      )}
      {main.length > 0 && (
        <div className={expanded ? 'sbh-main-grid sbh-expanded-share' : 'sbh-main-grid'}>
          {rects.map((rect, index) => (
            <div className="sbh-grid-cell" key={main[index].key} style={{ left: rect.x, top: rect.y }}>
              {renderTile(main[index], rect.width, rect.height)}
            </div>
          ))}
        </div>
      )}
      {sidebar.length > 0 && (
        <aside
          className={stacked ? 'sbh-participant-strip sbh-participant-strip--horizontal' : 'sbh-participant-strip'}
          aria-label="Participants and other screen shares"
          style={stacked ? { height: stripHeight } : { width: sidebarWidth }}
        >
          {sidebar.map((entry) => {
            const { width, height } = sidebarSize(entry);
            return renderTile(entry, width, height);
          })}
        </aside>
      )}
    </div>
  );
}
