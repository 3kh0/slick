export type ItemConfig = {
  id: string;
  name?: string;
  label?: string;
  hidden?: boolean;
  big?: boolean;
  section?: 'main' | 'organize';
};
export type MenuConfig = { order: ItemConfig[]; followCursor?: boolean; vimKeys?: boolean };
export type CatalogEntry = { id: string; name: string; big?: boolean; hidden?: boolean; section?: 'organize' };

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
  { id: 'pin', name: 'Pin to channel', section: 'organize' },
  { id: 'add_to_later_todos', name: 'Add to to-dos', section: 'organize' },
  { id: 'later', name: 'Add to saved', section: 'organize' },
  { id: 'mark_unread', name: 'Mark read/unread', section: 'organize' },
  { id: 'slick_ml_hide_edits', name: 'Hide edit history', section: 'organize' },
  { id: 'slick_ml_show_edits', name: 'Show edit history', section: 'organize' },
  { id: 'slick_ml_accept_delete', name: 'Accept deletion', section: 'organize' },
];

const ALIASES: Record<string, string[]> = {
  remind: ['remind_later', 'remind_me'],
  subscribe: ['follow_message'],
  comment: ['start_thread'],
  pin: ['pin_to_channel', 'unpin', 'unpin_from_channel'],
  later: ['star', 'save'],
  mark_unread: ['mark_thread_unread', 'mark_thread_read', 'mark_dms_tab_message_read'],
};
export const AUTO_BIG = ['copy_text', 'share_message'];
export const BIG_LABEL: Record<string, string> = {
  copy_link: 'Copy link',
  edit_message: 'Edit',
  delete_message: 'Delete',
  share_message: 'Forward',
  copy_text: 'Copy',
};
export const BIG_ICON: Record<string, string> = { delete_message: 'trash', copy_text: 'copy' };
export const ORGANISE_CHILDREN = [
  'pin',
  'add_to_later_todos',
  'later',
  'star',
  'save',
  'mark_unread',
  'mark_thread_unread',
  'mark_thread_read',
  'mark_dms_tab_message_read',
  'slick_ml_hide_edits',
  'slick_ml_show_edits',
  'slick_ml_accept_delete',
];
const byId = new Map<string, string>();
for (const entry of CATALOG) {
  byId.set(entry.id, entry.id);
  for (const alias of ALIASES[entry.id] ?? []) byId.set(alias, entry.id);
}
export function canonicalId(descriptor: { id?: string; 'data-qa'?: string }): string {
  return (descriptor.id && byId.get(descriptor.id)) || (descriptor['data-qa'] && byId.get(descriptor['data-qa'])) || '';
}
export function actionId(descriptor: { id?: string; 'data-qa'?: string }): string {
  return canonicalId(descriptor) || descriptor.id || descriptor['data-qa'] || '';
}
export function itemName(item: ItemConfig): string {
  return CATALOG.find((entry) => entry.id === item.id)?.name ?? item.name ?? item.id;
}
export function defaultConfig(): MenuConfig {
  return {
    order: CATALOG.map(({ id, hidden, big, section }) => ({ id, hidden, big, section })),
    followCursor: true,
    vimKeys: false,
  };
}
export function mergeCatalog(stored: MenuConfig | undefined): MenuConfig {
  const base = defaultConfig();
  if (!stored || !Array.isArray(stored.order)) return base;
  const defaults = new Map(base.order.map((entry) => [entry.id, entry]));
  const seen = new Set<string>();
  const order: ItemConfig[] = [];
  for (const item of stored.order) {
    if (!item || typeof item.id !== 'string' || !item.id || item.id.length > 160 || seen.has(item.id)) continue;
    const fallback = defaults.get(item.id);
    if (!fallback && typeof item.name !== 'string') continue;
    seen.add(item.id);
    order.push({
      id: item.id,
      ...(typeof item.name === 'string' ? { name: item.name.slice(0, 160) } : {}),
      label: typeof item.label === 'string' ? item.label : undefined,
      hidden: typeof item.hidden === 'boolean' ? item.hidden : fallback?.hidden,
      big: typeof item.big === 'boolean' ? item.big : fallback?.big,
      section: item.section === 'main' || item.section === 'organize' ? item.section : fallback?.section,
    });
  }
  for (const entry of base.order) if (!seen.has(entry.id)) order.push(entry);
  return { order, followCursor: stored.followCursor !== false, vimKeys: stored.vimKeys === true };
}

type Action = { id?: string; 'data-qa'?: string; name?: unknown; submenuActions?: Action[] };
export function discoverActions(config: MenuConfig, groups: Action[][]): MenuConfig {
  const known = new Set(config.order.map((item) => item.id));
  const added: ItemConfig[] = [];
  const remember = (action: Action, section: 'main' | 'organize') => {
    const id = actionId(action);
    if (!id || known.has(id)) return;
    known.add(id);
    added.push({ id, name: typeof action.name === 'string' ? action.name : id.replaceAll('_', ' '), section });
  };
  for (const action of groups.flat()) {
    remember(action, 'main');
    if (actionId(action) === 'organize_actions_menu')
      for (const child of action.submenuActions ?? []) remember(child, 'organize');
  }
  return added.length ? mergeCatalog({ ...config, order: [...config.order, ...added] }) : config;
}
