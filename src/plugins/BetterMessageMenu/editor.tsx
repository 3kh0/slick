// The plugin's own settings panel (rendered on its detail page): a reorderable
// list of menu items, each with a rename box, a show/hide toggle and an "icon
// row" toggle. Reorder is pointer-based (HTML5 drag is unreliable inside
// Slack/Electron). Reads and writes the plugin's MenuConfig store.

import { BIG_LABEL, CATALOG, defaultConfig, type ItemConfig, type MenuConfig } from './config.ts';

export type EditorHost = {
  store: { use(): MenuConfig; get(): MenuConfig };
  update(next: MenuConfig): void;
};

const nameOf = (id: string) => CATALOG.find((c) => c.id === id)?.name ?? id;
const placeholderOf = (id: string) => BIG_LABEL[id] ?? nameOf(id);

export function MenuEditor({ plugin }: { plugin: EditorHost }) {
  const saved = plugin.store.use();
  // While dragging, render a local preview order; commit on release.
  const [preview, setPreview] = React.useState<ItemConfig[] | null>(null);
  const [dragId, setDragId] = React.useState<string | null>(null);
  const rows = React.useRef(new Map<string, HTMLElement>());
  const order = preview ?? saved.order;

  const commit = (next: ItemConfig[], extra?: Partial<MenuConfig>) =>
    plugin.update({ ...saved, order: next, ...extra });
  const patch = (id: string, change: Partial<ItemConfig>) =>
    commit(saved.order.map((item) => (item.id === id ? { ...item, ...change } : item)));

  React.useEffect(() => {
    if (!dragId) return;
    const onMove = (e: PointerEvent) => {
      const current = preview ?? saved.order;
      const from = current.findIndex((i) => i.id === dragId);
      if (from < 0) return;
      let to = from;
      current.forEach((item, index) => {
        const el = rows.current.get(item.id);
        if (!el) return;
        const r = el.getBoundingClientRect();
        if (e.clientY >= r.top && e.clientY <= r.bottom) to = index;
      });
      if (to !== from) {
        const next = [...current];
        const [moved] = next.splice(from, 1);
        next.splice(to, 0, moved);
        setPreview(next);
      }
    };
    const onUp = () => {
      setPreview((p) => {
        if (p) commit(p);
        return null;
      });
      setDragId(null);
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    };
  }, [dragId, preview, saved.order]);

  return (
    <div className="slick-bmm-editor">
      <p className="slick-bmm-hint">
        Drag the handle to reorder. Type to rename an item (blank = Slack's default). “Icon” shows it as a button in the
        row at the edge of the menu.
      </p>
      <label className="slick-bmm-cursor">
        <input
          type="checkbox"
          checked={!!saved.followCursor}
          onChange={(e) => commit(saved.order, { followCursor: e.currentTarget.checked })}
        />
        Keep the icon row nearest the cursor
      </label>

      <div className="slick-bmm-list" role="list">
        {order.map((item) => (
          <div
            role="listitem"
            key={item.id}
            ref={(el) => {
              if (el) rows.current.set(item.id, el);
              else rows.current.delete(item.id);
            }}
            className={`slick-bmm-row${dragId === item.id ? ' slick-bmm-row--drag' : ''}${item.hidden ? ' slick-bmm-row--off' : ''}`}
          >
            <span
              className="slick-bmm-handle"
              aria-label={`Drag ${nameOf(item.id)}`}
              onPointerDown={(e) => {
                e.preventDefault();
                setDragId(item.id);
              }}
            >
              ⠿
            </span>
            <input
              className="slick-bmm-name"
              type="text"
              value={item.label ?? ''}
              placeholder={placeholderOf(item.id)}
              aria-label={`Label for ${nameOf(item.id)}`}
              onChange={(e) => patch(item.id, { label: e.currentTarget.value || undefined })}
            />
            <label className="slick-bmm-opt" title="Show in the menu">
              <input
                type="checkbox"
                checked={!item.hidden}
                onChange={(e) => patch(item.id, { hidden: !e.currentTarget.checked })}
              />
              Show
            </label>
            <label className="slick-bmm-opt" title="Show as an icon button in the row">
              <input
                type="checkbox"
                checked={!!item.big}
                onChange={(e) => patch(item.id, { big: e.currentTarget.checked })}
              />
              Icon
            </label>
          </div>
        ))}
      </div>

      <button type="button" className="slick-bmm-reset" onClick={() => plugin.update(defaultConfig())}>
        Reset to defaults
      </button>
    </div>
  );
}
