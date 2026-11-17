import { actionId, BIG_ICON, BIG_LABEL, type MenuConfig } from './config.ts';

export type Descriptor = {
  id?: string;
  name?: unknown;
  className?: string;
  'data-qa'?: string;
  submenuActions?: Descriptor[];
  [key: string]: unknown;
};
export type ActionGroups = Descriptor[][];
export type Placement = 'up' | 'down';
export const BIG_ACTION_CLASS = 'slick-bmm-bigaction';
const ORGANIZE = 'organize_actions_menu';

function labelFor(id: string, descriptor: Descriptor, big: boolean, label?: string): unknown {
  if (label?.trim()) return label.trim();
  if (big && BIG_LABEL[id]) return BIG_LABEL[id];
  if (!big && id === 'subscribe' && typeof descriptor.name === 'string' && /turn off/i.test(descriptor.name))
    return 'UNSUBSCRIBE';
  return descriptor.name;
}

export function applyMenu(groups: ActionGroups | undefined, config: MenuConfig, placement: Placement): ActionGroups {
  if (!Array.isArray(groups)) return groups ?? [];
  const flat = groups.flat().filter((action) => action && typeof action === 'object');
  const cfg = new Map(config.order.map((item) => [item.id, item]));
  const consumed = new Set<Descriptor>();
  const nativeOrganize = flat.find((action) => actionId(action) === ORGANIZE);
  const originalChildren = nativeOrganize?.submenuActions ?? [];
  for (const child of originalChildren)
    if (!flat.some((action) => actionId(action) === actionId(child))) flat.push(child);
  const take = (id: string): Descriptor | undefined => {
    const action = flat.find((item) => !consumed.has(item) && actionId(item) === id);
    if (action) consumed.add(action);
    return action;
  };

  const children: Descriptor[] = [];
  for (const item of config.order) {
    if (item.section !== 'organize' || item.id === ORGANIZE || item.big || item.hidden) continue;
    const child = take(item.id);
    if (child) children.push({ ...child, name: labelFor(item.id, child, false, item.label) });
  }
  for (const child of originalChildren) {
    if (consumed.has(child) || cfg.has(actionId(child))) continue;
    consumed.add(child);
    children.push(child);
  }
  if (nativeOrganize) flat[flat.indexOf(nativeOrganize)] = { ...nativeOrganize, submenuActions: children };
  else if (children.length) flat.push({ id: ORGANIZE, name: 'Organize', submenuActions: children });

  const own = flat.some((action) => ['edit_message', 'delete_message'].includes(actionId(action)));
  const bigIds = config.order
    .filter((item) => item.big && !item.hidden && item.section !== 'organize')
    .map((item) => item.id);
  if (!own) {
    for (const id of ['copy_link', 'share_message', 'copy_text']) {
      const item = cfg.get(id);
      if (!item?.hidden && item?.big !== false && !bigIds.includes(id)) bigIds.push(id);
    }
  }
  const taken: { id: string; action: Descriptor }[] = [];
  for (const id of bigIds) {
    const action = take(id);
    if (action) taken.push({ id, action });
  }
  const rows = Math.ceil(taken.length / 3);
  const counts = Array.from(
    { length: rows },
    (_, index) => Math.floor(taken.length / rows) + (index < taken.length % rows ? 1 : 0),
  ).flatMap((count) => Array(count).fill(count) as number[]);
  const bigGroup = taken.map(({ id, action }, index) => ({
    ...action,
    name: labelFor(id, action, true, cfg.get(id)?.label),
    icon: action.icon ?? BIG_ICON[id],
    className: [action.className, BIG_ACTION_CLASS, `${BIG_ACTION_CLASS}-n${counts[index]}`].filter(Boolean).join(' '),
  }));
  const main: Descriptor[] = [];
  for (const item of config.order) {
    if (item.hidden || item.big || item.section === 'organize') continue;
    const action = take(item.id);
    if (action) main.push({ ...action, name: labelFor(item.id, action, false, item.label) });
  }
  for (const action of flat) if (cfg.get(actionId(action))?.hidden) consumed.add(action);
  for (const action of flat) if (!consumed.has(action)) main.push(action);
  if (config.followCursor && placement === 'down') return [bigGroup, main].filter((group) => group.length);
  if (config.followCursor) main.reverse();
  return [main, bigGroup].filter((group) => group.length);
}
