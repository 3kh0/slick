import { AUTO_BIG, BIG_LABEL, defaultConfig, itemName, type ItemConfig, type MenuConfig } from './config.ts';

export type EditorHost = { store: { use(): MenuConfig; get(): MenuConfig }; update(next: MenuConfig): void };
type Kind = 'big' | 'item' | 'organize' | 'hidden';
const kindOf = (item: ItemConfig): Kind =>
  item.hidden ? 'hidden' : item.big ? 'big' : item.section === 'organize' ? 'organize' : 'item';
const GROUPS: { kind: Kind; title: string; hint: string }[] = [
  { kind: 'big', title: 'Big buttons', hint: 'Large actions near the cursor. Unavailable actions are omitted.' },
  {
    kind: 'item',
    title: 'Menu items',
    hint: 'Automatic Forward and Copy buttons move into the icon row on other people’s messages. Choose Menu item to keep them here.',
  },
  {
    kind: 'organize',
    title: 'Organize submenu',
    hint: 'Pin, saved items, to-dos, read status and MessageLogger actions. Drag to set their submenu order.',
  },
  { kind: 'hidden', title: 'Hidden', hint: 'These actions stay hidden on every message.' },
];

function ActionLabel({ item, rename }: { item: ItemConfig; rename: (label: string | undefined) => void }) {
  const name = itemName(item);
  const fallback = (item.big && BIG_LABEL[item.id]) || name;
  const label = item.label?.trim() || fallback;
  const [editing, setEditing] = React.useState(false);
  const [draft, setDraft] = React.useState('');
  const input = React.useRef<HTMLInputElement>(null);
  const button = React.useRef<HTMLButtonElement>(null);
  const active = React.useRef(false);
  const restoreFocus = React.useRef(false);

  React.useLayoutEffect(() => {
    if (editing) {
      input.current?.focus();
      input.current?.select();
    } else if (restoreFocus.current) {
      restoreFocus.current = false;
      button.current?.focus();
    }
  }, [editing]);

  const finish = (save: boolean) => {
    if (!active.current) return;
    active.current = false;
    if (save) rename(draft.trim() && draft.trim() !== fallback ? draft.trim() : undefined);
    setEditing(false);
  };

  if (editing)
    return (
      <input
        ref={input}
        className="slick-bmm-name"
        type="text"
        aria-label={`Label for ${name}`}
        value={draft}
        placeholder={fallback}
        onChange={(event) => setDraft(event.currentTarget.value)}
        onBlur={() => finish(true)}
        onKeyDown={(event) => {
          if (event.key !== 'Enter' && event.key !== 'Escape') return;
          event.preventDefault();
          event.stopPropagation();
          restoreFocus.current = true;
          finish(event.key === 'Enter');
        }}
      />
    );

  return (
    <span className="slick-bmm-label">
      <span title={label}>{label}</span>
      <button
        ref={button}
        type="button"
        className="slick-bmm-rename"
        aria-label={`Rename ${name}`}
        title="Rename"
        onClick={() => {
          setDraft(label);
          active.current = true;
          setEditing(true);
        }}
      >
        <svg
          width="14"
          height="14"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <path d="m16 3 5 5M3 21l5-1L21 7a3.5 3.5 0 0 0-5-5L3 15z" />
        </svg>
      </button>
    </span>
  );
}

export function MenuEditor({ plugin }: { plugin: EditorHost }) {
  const saved = plugin.store.use();
  const [preview, setPreview] = React.useState<ItemConfig[] | null>(null);
  const [dragId, setDragId] = React.useState<string | null>(null);
  const [filter, setFilter] = React.useState('');
  const [announcement, setAnnouncement] = React.useState('');
  const rows = React.useRef(new Map<string, HTMLElement>());
  const previewRef = React.useRef<ItemConfig[] | null>(null);
  const dragWindow = React.useRef<Window | null>(null);
  const order = preview ?? saved.order;
  const patch = (id: string, change: Partial<ItemConfig>) => {
    const current = plugin.store.get();
    plugin.update({ ...current, order: current.order.map((item) => (item.id === id ? { ...item, ...change } : item)) });
  };
  const move = (item: ItemConfig, direction: number) => {
    const current = plugin.store.get();
    const peers = current.order.filter((entry) => kindOf(entry) === kindOf(item));
    const neighbor = peers[peers.findIndex((entry) => entry.id === item.id) + direction];
    if (!neighbor) return;
    const next = [...current.order];
    const from = next.findIndex((entry) => entry.id === item.id);
    const to = next.findIndex((entry) => entry.id === neighbor.id);
    [next[from], next[to]] = [next[to], next[from]];
    plugin.update({ ...current, order: next });
    setAnnouncement(`${itemName(item)} moved ${direction < 0 ? 'up' : 'down'}`);
  };

  React.useEffect(() => {
    if (!dragId) return;
    const view = dragWindow.current ?? window;
    const onMove = (event: PointerEvent) => {
      const current = previewRef.current ?? plugin.store.get().order;
      const from = current.findIndex((item) => item.id === dragId);
      if (from < 0) return;
      const to = current.findIndex((item) => {
        if (kindOf(item) !== kindOf(current[from])) return false;
        const bounds = rows.current.get(item.id)?.getBoundingClientRect();
        return !!bounds && event.clientY >= bounds.top && event.clientY <= bounds.bottom;
      });
      if (to < 0 || to === from) return;
      const next = [...current];
      const [moved] = next.splice(from, 1);
      next.splice(to, 0, moved);
      previewRef.current = next;
      setPreview(next);
    };
    const end = (event: PointerEvent) => {
      if (previewRef.current && event.type !== 'pointercancel')
        plugin.update({ ...plugin.store.get(), order: previewRef.current });
      previewRef.current = null;
      setPreview(null);
      setDragId(null);
    };
    view.addEventListener('pointermove', onMove);
    view.addEventListener('pointerup', end);
    view.addEventListener('pointercancel', end);
    return () => {
      view.removeEventListener('pointermove', onMove);
      view.removeEventListener('pointerup', end);
      view.removeEventListener('pointercancel', end);
    };
  }, [dragId, plugin]);

  return (
    <div className="slick-bmm-editor">
      <p className="slick-bmm-hint">
        Drag handles or use the arrow buttons to reorder. Rename an action, choose where it appears, or hide it. More
        actions appear here as you open message menus.
      </p>
      <label className="slick-bmm-cursor">
        <input
          type="checkbox"
          checked={!!saved.followCursor}
          onChange={(event) => plugin.update({ ...plugin.store.get(), followCursor: event.currentTarget.checked })}
        />
        Keep the big buttons nearest the cursor
      </label>
      <label className="slick-bmm-cursor">
        <input
          type="checkbox"
          checked={!!saved.vimKeys}
          onChange={(event) => plugin.update({ ...plugin.store.get(), vimKeys: event.currentTarget.checked })}
        />
        Vim navigation: J/K to move, H/L to close/open submenus
      </label>
      <input
        className="slick-bmm-name"
        type="search"
        aria-label="Filter menu actions"
        placeholder="Find a menu action…"
        value={filter}
        onChange={(event) => setFilter(event.currentTarget.value)}
      />
      <p className="slick-bmm-announcement" role="status">
        {announcement}
      </p>
      {GROUPS.map(({ kind, title, hint }) => {
        const peers = order.filter((item) => kindOf(item) === kind);
        const items = peers.filter((item) =>
          `${itemName(item)} ${item.label ?? ''}`.toLowerCase().includes(filter.toLowerCase()),
        );
        return (
          <section key={kind} className={`slick-bmm-group slick-bmm-group--${kind}`}>
            <div className="slick-bmm-group-head">
              <span className="slick-bmm-group-title">{title}</span>
              <span className="slick-bmm-hint">{hint}</span>
            </div>
            <div className="slick-bmm-list" role="list" aria-label={title}>
              {items.length ? (
                items.map((item) => {
                  const name = itemName(item);
                  const automatic = kind === 'item' && item.big === undefined && AUTO_BIG.includes(item.id);
                  return (
                    <div
                      role="listitem"
                      key={item.id}
                      data-action-id={item.id}
                      ref={(element) => {
                        if (element) rows.current.set(item.id, element);
                        else rows.current.delete(item.id);
                      }}
                      className={`slick-bmm-row${dragId === item.id ? ' slick-bmm-row--drag' : ''}`}
                    >
                      <span
                        className="slick-bmm-handle"
                        aria-label={`Drag ${name}`}
                        onPointerDown={(event) => {
                          if (event.button !== 0) return;
                          event.preventDefault();
                          event.currentTarget.setPointerCapture(event.pointerId);
                          dragWindow.current = event.currentTarget.ownerDocument.defaultView;
                          setDragId(item.id);
                        }}
                      >
                        ⠿
                      </span>
                      <span className="slick-bmm-order">
                        <button
                          type="button"
                          aria-label={`Move ${name} up`}
                          disabled={peers[0]?.id === item.id}
                          onClick={() => move(item, -1)}
                        >
                          ↑
                        </button>
                        <button
                          type="button"
                          aria-label={`Move ${name} down`}
                          disabled={peers.at(-1)?.id === item.id}
                          onClick={() => move(item, 1)}
                        >
                          ↓
                        </button>
                      </span>
                      <ActionLabel item={item} rename={(label) => patch(item.id, { label })} />
                      <select
                        className="slick-bmm-kind"
                        value={automatic ? 'auto' : kind}
                        aria-label={`How ${name} shows`}
                        onChange={(event) => {
                          const value = event.currentTarget.value;
                          patch(item.id, {
                            hidden: value === 'hidden',
                            big: value === 'auto' ? undefined : value === 'big',
                            section: value === 'organize' ? 'organize' : 'main',
                          });
                        }}
                      >
                        {AUTO_BIG.includes(item.id) && <option value="auto">Automatic</option>}
                        <option value="big">Big button</option>
                        <option value="item">Menu item</option>
                        {item.id !== 'organize_actions_menu' && <option value="organize">Organize submenu</option>}
                        <option value="hidden">Hidden</option>
                      </select>
                    </div>
                  );
                })
              ) : (
                <div className="slick-bmm-empty">{filter ? 'No matching actions.' : 'Nothing here.'}</div>
              )}
            </div>
          </section>
        );
      })}
      <button type="button" className="slick-bmm-reset" onClick={() => plugin.update(defaultConfig())}>
        Reset to defaults
      </button>
    </div>
  );
}
