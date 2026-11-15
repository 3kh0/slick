// Pointer-based reorder: HTML5 drag is unreliable inside Slack's Electron window.

import { BIG_LABEL, CATALOG, defaultConfig, type ItemConfig, type MenuConfig } from './config.ts';

export type EditorHost = {
  store: { use(): MenuConfig; get(): MenuConfig };
  update(next: MenuConfig): void;
};

type Kind = 'big' | 'item' | 'hidden';

const kindOf = (item: ItemConfig): Kind => (item.hidden ? 'hidden' : item.big ? 'big' : 'item');
const asKind = (kind: Kind): Partial<ItemConfig> => ({ hidden: kind === 'hidden', big: kind === 'big' });

const GROUPS: { kind: Kind; title: string; hint: string }[] = [
  {
    kind: 'big',
    title: 'Big buttons',
    hint: 'Shown side by side as icon buttons. On other people’s messages, Edit and Delete give way to Forward and Copy.',
  },
  { kind: 'item', title: 'Menu items', hint: 'Shown as normal rows in the menu.' },
  { kind: 'hidden', title: 'Hidden', hint: 'Left out of the menu.' },
];

const nameOf = (id: string) => CATALOG.find((c) => c.id === id)?.name ?? id;

export function MenuEditor({ plugin }: { plugin: EditorHost }) {
  const saved = plugin.store.use();
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
      const kind = kindOf(current[from]);
      // Only rows in the same group are drop targets; groups change via the dropdown.
      const to = current.findIndex((item) => {
        if (kindOf(item) !== kind) return false;
        const r = rows.current.get(item.id)?.getBoundingClientRect();
        return !!r && e.clientY >= r.top && e.clientY <= r.bottom;
      });
      if (to < 0 || to === from) return;
      const next = [...current];
      const [moved] = next.splice(from, 1);
      next.splice(to, 0, moved);
      setPreview(next);
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

  const row = (item: ItemConfig) => (
    <div
      role="listitem"
      key={item.id}
      ref={(el) => {
        if (el) rows.current.set(item.id, el);
        else rows.current.delete(item.id);
      }}
      className={`slick-bmm-row${dragId === item.id ? ' slick-bmm-row--drag' : ''}`}
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
        placeholder={(item.big && BIG_LABEL[item.id]) || nameOf(item.id)}
        aria-label={`Label for ${nameOf(item.id)}`}
        onChange={(e) => patch(item.id, { label: e.currentTarget.value || undefined })}
      />
      <select
        className="slick-bmm-kind"
        value={kindOf(item)}
        aria-label={`How ${nameOf(item.id)} shows`}
        onChange={(e) => patch(item.id, asKind(e.currentTarget.value as Kind))}
      >
        <option value="big">Big button</option>
        <option value="item">Menu item</option>
        <option value="hidden">Hidden</option>
      </select>
    </div>
  );

  return (
    <div className="slick-bmm-editor">
      <p className="slick-bmm-hint">
        Drag the handle to reorder within a group. Type to rename an item; leave it blank for Slack’s name.
      </p>
      <label className="slick-bmm-cursor">
        <input
          type="checkbox"
          checked={!!saved.followCursor}
          onChange={(e) => commit(saved.order, { followCursor: e.currentTarget.checked })}
        />
        Keep the big buttons nearest the cursor
      </label>

      {GROUPS.map(({ kind, title, hint }) => {
        const items = order.filter((item) => kindOf(item) === kind);
        return (
          <div key={kind} className={`slick-bmm-group slick-bmm-group--${kind}`}>
            <div className="slick-bmm-group-head">
              <span className="slick-bmm-group-title">{title}</span>
              <span className="slick-bmm-hint">{hint}</span>
            </div>
            <div className="slick-bmm-list" role="list" aria-label={title}>
              {items.length ? items.map(row) : <div className="slick-bmm-empty">Nothing here.</div>}
            </div>
          </div>
        );
      })}

      <button type="button" className="slick-bmm-reset" onClick={() => plugin.update(defaultConfig())}>
        Reset to defaults
      </button>
    </div>
  );
}
