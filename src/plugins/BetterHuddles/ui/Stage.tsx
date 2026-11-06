// Everyone in the call as a tile (camera or profile photo) plus screen shares,
// sized as large as the space allows at each stream's real shape. With the
// "shrink people without video" setting, those share square 2×2 slots.

import {
  buildStageEntries,
  buildStageSlots,
  DEFAULT_VIDEO_ASPECT_RATIO,
  fitTileHeight,
  PHOTO_ASPECT_RATIO,
  type StageEntry,
  type StageSlot,
} from '../media/stageLayout.ts';
import { useCallState, useHuddleUi } from './context.ts';
import { StageTile } from './StageTile.tsx';

const TILE_GAP = 12;
// Between the small tiles inside a group slot.
const GROUP_GAP = 6;

function useElementSize(ref: React.RefObject<HTMLElement | null>) {
  const [size, setSize] = React.useState({ width: 0, height: 0 });
  React.useEffect(() => {
    const element = ref.current;
    if (!element) return;
    const observer = new ResizeObserver(([observed]) => {
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

/** Up to four people without video in one square slot, as a 2×2 grid of small square tiles. */
function GroupSlot({
  entries,
  width,
  height,
  renderTile,
}: {
  entries: StageEntry[];
  width: number;
  height: number;
  renderTile: TileRenderer;
}) {
  const cellWidth = Math.floor((width - GROUP_GAP) / 2);
  const cellHeight = Math.floor((height - GROUP_GAP) / 2);
  return (
    <div className="sbh-group" style={{ width, height, gap: GROUP_GAP }}>
      {entries.map((entry) => renderTile(entry, cellWidth, cellHeight))}
    </div>
  );
}

/** The stage's slots and their shapes; a group of people without video is square, like their photos. */
function useStageSlots(entries: StageEntry[], videoRatios: Record<number, number>) {
  const { useCompactNoVideo } = useHuddleUi();
  const slots = buildStageSlots(entries, useCompactNoVideo());
  const aspectRatioOf = (slot: StageSlot) => {
    if (slot.kind === 'group') return PHOTO_ASPECT_RATIO;
    const entry = slot.entry;
    return entry.kind === 'photo' ? PHOTO_ASPECT_RATIO : (videoRatios[entry.tile.tileId] ?? DEFAULT_VIDEO_ASPECT_RATIO);
  };
  return { slots, aspectRatios: slots.map(aspectRatioOf) };
}

interface StageProps {
  onControlError: (prefix: string, error: unknown) => void;
  /** Opens or closes the video-effect editor (the gear on your own tile). */
  onToggleSettings: () => void;
}

export function Stage({ onControlError, onToggleSettings }: StageProps) {
  const { call } = useHuddleUi();
  const state = useCallState();
  const stageRef = React.useRef<HTMLDivElement>(null);
  const stageSize = useElementSize(stageRef);
  // Real stream shapes, learned from each <video> as it loads.
  const [videoRatios, setVideoRatios] = React.useState<Record<number, number>>({});

  // Chime reports you first; Slack's room list shows you last, after the people
  // already there. buildStageEntries appends the local user when they're missing from the list.
  const others = state.participants.filter((userId) => userId !== state.localUserId);
  const entries = state.status === 'connected' ? buildStageEntries(state.tiles, others, state.localUserId) : [];
  const { slots, aspectRatios } = useStageSlots(entries, videoRatios);
  // The ResizeObserver size excludes padding; 1px spare absorbs sub-pixel rounding so rows don't wrap early.
  const tileHeight = fitTileHeight(aspectRatios, stageSize.width - 1, stageSize.height - 1, TILE_GAP);

  // Only download as much resolution as the tiles show.
  React.useEffect(() => {
    call.setVideoDisplayHeight(entries.length ? tileHeight : 0);
  }, [call, entries.length, tileHeight]);
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
      onRatio={(ratio) => {
        if (entry.kind !== 'video' || videoRatios[entry.tile.tileId] === ratio) return;
        setVideoRatios((current) => ({ ...current, [entry.tile.tileId]: ratio }));
      }}
      onToggleShader={toggleShader}
      onOpenSettings={onToggleSettings}
    />
  );

  return (
    <div className="sbh-stage" ref={stageRef} style={{ gap: TILE_GAP }}>
      {state.status === 'joining' && (
        <p className="sbh-stage-status" role="status">
          Connecting…
        </p>
      )}
      {tileHeight > 0 &&
        slots.map((slot, index) => {
          const width = Math.floor(tileHeight * aspectRatios[index]);
          if (slot.kind === 'single') return renderTile(slot.entry, width, tileHeight);
          return (
            <GroupSlot
              key={slot.key}
              entries={slot.entries}
              width={width}
              height={tileHeight}
              renderTile={renderTile}
            />
          );
        })}
    </div>
  );
}
