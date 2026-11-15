// The saved shape of the menu: an ordered list of items, each optionally
// renamed, hidden, or promoted into the icon row. Persisted as JSON via
// api.storage; the editor and the transform both read it.

export type ItemConfig = { id: string; label?: string; hidden?: boolean; big?: boolean };
export type MenuConfig = { order: ItemConfig[]; followCursor?: boolean };

export type CatalogEntry = {
  /** Canonical id used in config and the editor. */
  id: string;
  /** Name shown in the editor row. */
  name: string;
  /** Default: belongs in the icon row. */
  big?: boolean;
  /** Default: hidden from the menu. */
  hidden?: boolean;
};

// Top-level items the editor manages. Organise's own children (pin, saved,
// mark-read, to-dos) are grouped into its submenu structurally, not listed here.
export const CATALOG: CatalogEntry[] = [
  { id: 'copy_text', name: 'Copy message' },
  { id: 'remind', name: 'Add a reminder' },
  { id: 'subscribe', name: 'Turn off/on reply notifications' },
  { id: 'organize_actions_menu', name: 'Organize' },
  { id: 'connect_to_apps_actions_menu', name: 'Connect to apps' },
  { id: 'share_message', name: 'Forward message' },
  { id: 'copy_link', name: 'Copy link', big: true },
  { id: 'edit_message', name: 'Edit message', big: true },
  { id: 'delete_message', name: 'Delete message', big: true },
  { id: 'add_reaction', name: 'Add reaction', hidden: true },
  { id: 'comment', name: 'Reply in thread', hidden: true },
];

// Live descriptor ids/data-qas that map onto a canonical catalog id.
const ALIASES: Record<string, string[]> = {
  remind: ['remind', 'remind_later', 'remind_me'],
  subscribe: ['subscribe', 'follow_message'],
  comment: ['comment', 'start_thread'],
};

// Short labels used only inside the icon row.
export const BIG_LABEL: Record<string, string> = {
  copy_link: 'Copy link',
  edit_message: 'Edit',
  delete_message: 'Delete',
  share_message: 'Forward',
  copy_text: 'Copy',
};
// Fallback icons where Slack ships none (Slack renders a string `icon` as an SvgIcon).
export const BIG_ICON: Record<string, string> = { delete_message: 'trash', copy_text: 'copy' };

/** The organize submenu absorbs these top-level items (Pin already lives inside it). */
export const ORGANISE_CHILDREN = [
  'add_to_later_todos',
  'later',
  'star',
  'save',
  'mark_unread',
  'mark_thread_unread',
  'mark_thread_read',
  'mark_dms_tab_message_read',
];

const byId = new Map<string, string>();
for (const entry of CATALOG) {
  byId.set(entry.id, entry.id);
  for (const alias of ALIASES[entry.id] ?? []) byId.set(alias, entry.id);
}

/** The catalog id a live descriptor maps to, or '' if it is not a catalog item. */
export function canonicalId(descriptor: { id?: string; 'data-qa'?: string }): string {
  return (descriptor.id && byId.get(descriptor.id)) || (descriptor['data-qa'] && byId.get(descriptor['data-qa'])) || '';
}

export function defaultConfig(): MenuConfig {
  return {
    order: CATALOG.map((c) => ({ id: c.id, hidden: c.hidden, big: c.big })),
    followCursor: true,
  };
}

/**
 * Reconcile a stored config with the catalog: drop unknown ids, keep the user's
 * order and overrides, and append any catalog items the config is missing (so a
 * newly-added item shows up rather than vanishing).
 */
export function mergeCatalog(stored: MenuConfig | undefined): MenuConfig {
  const base = defaultConfig();
  if (!stored || !Array.isArray(stored.order)) return base;
  const known = new Set(CATALOG.map((c) => c.id));
  const seen = new Set<string>();
  const order: ItemConfig[] = [];
  for (const item of stored.order) {
    if (!item || typeof item.id !== 'string' || !known.has(item.id) || seen.has(item.id)) continue;
    seen.add(item.id);
    order.push({
      id: item.id,
      label: typeof item.label === 'string' ? item.label : undefined,
      hidden: !!item.hidden,
      big: !!item.big,
    });
  }
  for (const entry of base.order) if (!seen.has(entry.id)) order.push(entry);
  return { order, followCursor: stored.followCursor !== false };
}
