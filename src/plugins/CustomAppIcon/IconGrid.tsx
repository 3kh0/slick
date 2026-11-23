import { ICONS, type ImportResult } from './icons.ts';

export type IconGridHost = {
  selection: { use(): string };
  appearance: { use(): string };
  autoInvert: { use(): boolean };
  loadPreviews(appearance: string, auto: boolean): Promise<Record<string, string> | null>;
  loadCustomPreview(): Promise<string | null>;
  choose(icon: string): Promise<void>;
  upload(): Promise<ImportResult>;
  removeCustom(): Promise<boolean>;
};

const SLACK_ICONS = new Set(['slack', 'slack-inverted']);

const UPLOAD_ERRORS: Partial<Record<ImportResult, string>> = {
  unreadable: 'That file isn’t a PNG or JPEG image.',
  failed: 'Couldn’t save that icon. Try again.',
};

/** Keeps the previous value while a reload is in flight; `null` when loading failed. */
function useLoaded<T>(load: () => Promise<T | null>, key: unknown): T | null | undefined {
  const [value, setValue] = React.useState<T | null>();
  React.useEffect(() => {
    let live = true;
    void load().then((next) => live && setValue(next));
    return () => {
      live = false;
    };
  }, [key]);
  return value;
}

const iconImage = (src: string | null | undefined) =>
  src ? (
    <img className="slick-app-icons__image" src={src} alt="" />
  ) : (
    <span className="slick-app-icons__placeholder" aria-hidden="true" />
  );

function Tile({
  checked,
  image,
  label,
  detail,
  onSelect,
  onMenu,
}: {
  checked: boolean;
  image: string | null | undefined;
  label: string;
  detail: string;
  onSelect: () => void;
  onMenu?: (x: number, y: number) => void;
}) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={checked}
      className="slick-app-icons__tile"
      onClick={onSelect}
      onContextMenu={
        onMenu &&
        ((event) => {
          event.preventDefault();
          onMenu(event.clientX, event.clientY);
        })
      }
      onKeyDown={
        onMenu &&
        ((event) => {
          if (event.key !== 'ContextMenu' && !(event.shiftKey && event.key === 'F10')) return;
          event.preventDefault();
          const rect = event.currentTarget.getBoundingClientRect();
          onMenu(rect.left, rect.bottom);
        })
      }
    >
      {iconImage(image)}
      <span className="slick-app-icons__label">{label}</span>
      <span className="slick-app-icons__detail">{detail}</span>
    </button>
  );
}

function RemoveMenu({ x, y, onRemove, dismiss }: { x: number; y: number; onRemove: () => void; dismiss: () => void }) {
  const ref = React.useRef<HTMLDivElement>(null);
  React.useLayoutEffect(() => {
    const popup = ref.current!;
    popup.showPopover();
    const rect = popup.getBoundingClientRect();
    popup.style.left = `${Math.max(4, Math.min(x, innerWidth - rect.width - 4))}px`;
    popup.style.top = `${Math.max(4, Math.min(y, innerHeight - rect.height - 4))}px`;
    popup.querySelector('button')?.focus();
    const outside = (event: PointerEvent) => {
      if (!popup.contains(event.target as Node)) dismiss();
    };
    // Captured so Escape closes only this menu, not the Preferences dialog behind it.
    const escape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      event.stopPropagation();
      dismiss();
    };
    document.addEventListener('pointerdown', outside, true);
    document.addEventListener('keydown', escape, true);
    return () => {
      document.removeEventListener('pointerdown', outside, true);
      document.removeEventListener('keydown', escape, true);
    };
  }, [x, y]);
  return (
    <div ref={ref} className="slick-app-icons__menu" popover="manual" role="menu" aria-label="Custom icon">
      <button
        type="button"
        role="menuitem"
        onClick={() => {
          dismiss();
          onRemove();
        }}
      >
        Remove custom icon
      </button>
    </div>
  );
}

export function IconGrid({ host }: { host: IconGridHost }) {
  const icon = host.selection.use();
  const appearance = host.appearance.use();
  const autoInvert = host.autoInvert.use();
  const [revision, setRevision] = React.useState(0);
  const [menu, setMenu] = React.useState<{ x: number; y: number } | null>(null);
  const [error, setError] = React.useState('');
  const previews = useLoaded(() => host.loadPreviews(appearance, autoInvert), `${appearance}:${autoInvert}`);
  const customPreview = useLoaded(() => host.loadCustomPreview(), revision);

  const upload = async () => {
    const result = await host.upload();
    setError(UPLOAD_ERRORS[result] ?? '');
    if (result === 'saved') setRevision((value) => value + 1);
  };

  const remove = async () => {
    const removed = await host.removeCustom();
    setError(removed ? '' : 'Couldn’t remove the custom icon. Try again.');
    if (removed) setRevision((value) => value + 1);
  };

  return (
    <>
      <div role="radiogroup" aria-label="App icon" className="slick-app-icons">
        {ICONS.filter(({ id }) => !SLACK_ICONS.has(id) || previews?.[id]).map(({ id, label, author }) => (
          <Tile
            key={id}
            checked={icon === id}
            image={previews?.[id]}
            label={label}
            detail={`by ${author}`}
            onSelect={() => void host.choose(id)}
          />
        ))}
        {customPreview && (
          <Tile
            checked={icon === 'custom'}
            image={customPreview}
            label="Custom"
            detail="Right-click to remove"
            onSelect={() => void host.choose('custom')}
            onMenu={(x, y) => setMenu({ x, y })}
          />
        )}
        <button type="button" className="slick-app-icons__tile" onClick={() => void upload()}>
          <span className="slick-app-icons__placeholder" aria-hidden="true">
            +
          </span>
          <span className="slick-app-icons__label">{customPreview ? 'Replace…' : 'Upload…'}</span>
          <span className="slick-app-icons__detail">PNG or JPEG</span>
        </button>
      </div>
      {error && (
        <p className="slick-app-icons__status" role="alert">
          {error}
        </p>
      )}
      {menu && customPreview && <RemoveMenu {...menu} onRemove={() => void remove()} dismiss={() => setMenu(null)} />}
    </>
  );
}
