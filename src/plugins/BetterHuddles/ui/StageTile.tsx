// One person (or screen share) on the stage: their video, or their full-size
// profile photo while the camera is off, with a name pill and a glowing ring
// while they talk.

import { nameWithPronouns, tileTextScale, type StageEntry } from '../media/stageLayout.ts';
import { avatarHue, avatarInitials, memberDisplayName, memberPhotoUrl, memberPronouns } from './callText.ts';
import { useHuddleUi } from './context.ts';
import { Icon } from './icons.tsx';

interface VideoTileProps {
  tileId: number;
  mirrored: boolean;
  fit: 'cover' | 'contain';
  onRatio: (aspectRatio: number) => void;
}

/** A <video> for one Chime tile; reports the stream's real shape so the layout can size the tile to it. */
function VideoTile({ tileId, mirrored, fit, onRatio }: VideoTileProps) {
  const { call } = useHuddleUi();
  const videoRef = React.useRef<HTMLVideoElement>(null);

  React.useEffect(() => {
    const element = videoRef.current;
    if (!element) return;
    call.bindTile(tileId, element);
    return () => call.unbindTile(tileId);
  }, [call, tileId]);

  // `resize` fires when the stream's dimensions change (camera rotated, window share resized...).
  const reportRatio = () => {
    const element = videoRef.current;
    if (element?.videoWidth && element.videoHeight) onRatio(element.videoWidth / element.videoHeight);
  };
  React.useEffect(() => {
    const element = videoRef.current;
    element?.addEventListener('resize', reportRatio);
    return () => element?.removeEventListener('resize', reportRatio);
  });

  // Muted: huddle audio plays through the session's own audio element, not per tile.
  return (
    <video
      ref={videoRef}
      className={mirrored ? 'sbh-video sbh-video--mirrored' : 'sbh-video'}
      style={{ objectFit: fit }}
      autoPlay
      playsInline
      muted
      onLoadedMetadata={reportRatio}
    />
  );
}

interface NamePillProps {
  name: string;
  pronouns: string;
  speaking: boolean;
  muted: boolean;
  screenShare: boolean;
}

/** "▮▮▮ Sofia Egan (they/them)"; bars animate while they talk. */
function NamePill({ name, pronouns, speaking, muted, screenShare }: NamePillProps) {
  let indicator: React.ReactNode = null;
  if (screenShare) indicator = <Icon name="monitor-up" size={14} />;
  else if (muted)
    indicator = (
      <span className="sbh-pill-muted" aria-label="Muted">
        <Icon name="mic-off" size={14} />
      </span>
    );
  else if (speaking)
    indicator = (
      <span className="sbh-bars" aria-label="Speaking">
        <i />
        <i />
        <i />
        <i />
      </span>
    );
  return (
    <span className="sbh-pill" title={pronouns ? `${name} ${pronouns}` : name}>
      {indicator}
      <strong>{screenShare ? `${name}'s screen` : name}</strong>
      {pronouns && !screenShare && <span className="sbh-pill-pronouns">{pronouns}</span>}
    </span>
  );
}

/** On your own tile: send your shader instead of your camera (works with the camera off too). */
function ShaderToggle({ active, onToggle }: { active: boolean; onToggle: () => void }) {
  const label = active ? 'Stop your video effect' : 'Send your video effect';
  return (
    <button
      type="button"
      className={active ? 'sbh-corner-button sbh-corner-button--active' : 'sbh-corner-button'}
      onClick={onToggle}
      aria-pressed={active}
      title={label}
      aria-label={label}
    >
      <Icon name="sparkles" size={14} />
    </button>
  );
}

/** On your own tile, shown while you hover it: opens the video-effect editor. */
function SettingsButton({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      className="sbh-corner-button sbh-corner-button--on-hover"
      onClick={onClick}
      title="Edit your video effect"
      aria-label="Edit your video effect"
    >
      <Icon name="settings" size={14} />
    </button>
  );
}

export interface StageTileProps {
  entry: StageEntry;
  width: number;
  height: number;
  speaking: boolean;
  muted: boolean;
  /** This tile is you (your camera, effect or photo). */
  isYou: boolean;
  shaderOn: boolean;
  onRatio: (aspectRatio: number) => void;
  onToggleShader: () => void;
  onOpenSettings: () => void;
  expanded?: boolean;
  onToggleExpanded?: () => void;
}

export function StageTile({
  entry,
  width,
  height,
  speaking,
  muted,
  isYou,
  shaderOn,
  onRatio,
  onToggleShader,
  onOpenSettings,
  expanded = false,
  onToggleExpanded,
}: StageTileProps) {
  const { useMember } = useHuddleUi();
  const member = useMember(entry.userId ?? '');
  const label = nameWithPronouns(entry.userId ? memberDisplayName(member) : 'Someone', memberPronouns(member));
  const photoUrl = memberPhotoUrl(member);
  const [failedPhoto, setFailedPhoto] = React.useState('');
  const isScreenShare = entry.kind === 'video' && entry.tile.isContent;
  const isOwnCamera = entry.kind === 'video' && entry.tile.isLocal && !entry.tile.isContent;
  const talking = speaking && !isScreenShare;

  let media: React.ReactNode;
  if (entry.kind === 'video') {
    media = (
      <VideoTile tileId={entry.tile.tileId} mirrored={isOwnCamera && !shaderOn} fit="contain" onRatio={onRatio} />
    );
  } else if (photoUrl && failedPhoto !== photoUrl) {
    media = (
      <img
        className="sbh-photo"
        src={photoUrl}
        alt=""
        decoding="async"
        referrerPolicy="no-referrer"
        onError={() => setFailedPhoto(photoUrl)}
      />
    );
  } else {
    // No photo: the person's colour fills the whole tile, like a photo would, with initials sized to it.
    media = (
      <div
        className="sbh-initial"
        aria-hidden="true"
        style={{
          fontSize: Math.round(Math.min(width, height) * 0.3),
          background: `hsl(${avatarHue(entry.userId ?? label.name)} 45% 38%)`,
        }}
      >
        {avatarInitials(label.name)}
      </div>
    );
  }

  return (
    <figure
      className={talking ? 'sbh-tile sbh-tile--speaking' : 'sbh-tile'}
      style={{ width, height, '--sbh-scale': tileTextScale(width, height) } as React.CSSProperties}
    >
      {media}
      {isScreenShare && onToggleExpanded && (
        <button
          type="button"
          className="sbh-share-expand"
          aria-label={expanded ? 'Return to grid' : `Expand ${label.name}'s screen`}
          aria-pressed={expanded}
          onClick={onToggleExpanded}
          title={expanded ? 'Return to grid (Escape)' : 'Expand screen share'}
        >
          <span>
            <Icon name={expanded ? 'minimize-2' : 'maximize-2'} size={18} />
          </span>
        </button>
      )}
      {isYou && !isScreenShare && (
        <div className="sbh-corner">
          <SettingsButton onClick={onOpenSettings} />
          <ShaderToggle active={shaderOn} onToggle={onToggleShader} />
        </div>
      )}
      <figcaption className="sbh-caption">
        <NamePill
          name={label.name}
          pronouns={label.pronouns}
          speaking={talking}
          muted={muted && !isScreenShare}
          screenShare={isScreenShare}
        />
      </figcaption>
    </figure>
  );
}
