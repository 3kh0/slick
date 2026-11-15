// Pure rewrite of Slack's message-actions template, driven by the user's saved
// MenuConfig. MessageActionsMenu passes its body (MAMenu) `actions`: a 2-D array
// of plain descriptor objects, rendered group-by-group with a separator between
// groups. Reshaping that array is the whole plugin — no React, no DOM.

import { BIG_ICON, BIG_LABEL, canonicalId, type MenuConfig, ORGANISE_CHILDREN } from './config.ts';

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

/** Marker the stylesheet keys the horizontal icon row off. */
export const BIG_ACTION_CLASS = 'slick-bmm-bigaction';

const ORGANIZE = 'organize_actions_menu';

const is = (d: Descriptor, keys: readonly string[]): boolean =>
  keys.includes(d.id as string) || keys.includes(d['data-qa'] as string);

/** The label to render: a user rename wins, then our defaults, then Slack's own. */
function labelFor(canon: string, d: Descriptor, inBig: boolean, userLabel?: string): unknown {
  if (userLabel && userLabel.trim()) return userLabel.trim();
  if (inBig && BIG_LABEL[canon]) return BIG_LABEL[canon];
  if (!inBig && canon === 'subscribe' && typeof d.name === 'string' && /turn off/i.test(d.name)) return 'UNSUBSCRIBE';
  return d.name;
}

/**
 * Reshape the live `actions` into the configured menu. Unknown descriptors
 * (app shortcuts, AI actions, …) are preserved so nothing is ever lost.
 */
export function applyMenu(groups: ActionGroups | undefined, config: MenuConfig, placement: Placement): ActionGroups {
  if (!Array.isArray(groups)) return groups ?? [];

  const flat = groups.flat().filter((d): d is Descriptor => !!d && typeof d === 'object');
  const cfg = new Map(config.order.map((item) => [item.id, item]));
  const consumed = new Set<Descriptor>();

  // Does Slack offer Edit/Delete? Only on the viewer's own message.
  const own = flat.some((d) => ['edit_message', 'delete_message'].includes(canonicalId(d)));

  // Which canonical ids go in the icon row.
  let bigIds = config.order.filter((item) => item.big && !item.hidden).map((item) => item.id);
  if (!own) {
    // Edit/Delete are absent; move Forward + Copy message down into the row instead.
    bigIds = bigIds.filter((id) => id !== 'edit_message' && id !== 'delete_message');
    for (const id of ['copy_link', 'share_message', 'copy_text']) if (!bigIds.includes(id)) bigIds.push(id);
  }

  const take = (canon: string): Descriptor | undefined => {
    const found = flat.find((d) => !consumed.has(d) && canonicalId(d) === canon);
    if (found) consumed.add(found);
    return found;
  };

  // Icon row, in configured order. Width is split by how many actually render
  // (e.g. a channel with forwarding off drops to two), so the row always fills.
  const taken: { canon: string; d: Descriptor }[] = [];
  for (const canon of bigIds) {
    const d = take(canon);
    if (d) taken.push({ canon, d });
  }
  const bigGroup: Descriptor[] = taken.map(({ canon, d }) => ({
    ...d,
    name: labelFor(canon, d, true, cfg.get(canon)?.label),
    icon: d.icon ?? BIG_ICON[canon],
    className: [d.className, BIG_ACTION_CLASS, `${BIG_ACTION_CLASS}-n${taken.length}`].filter(Boolean).join(' '),
  }));

  // Organise submenu absorbs its stray top-level children. Replace the descriptor
  // in `flat` with a merged copy so the ordering pass below places it normally.
  const organize = flat.find((d) => !consumed.has(d) && canonicalId(d) === ORGANIZE);
  if (organize) {
    const moved = flat.filter((d) => !consumed.has(d) && is(d, ORGANISE_CHILDREN));
    if (moved.length) {
      moved.forEach((d) => consumed.add(d));
      flat[flat.indexOf(organize)] = {
        ...organize,
        submenuActions: [...(organize.submenuActions ?? []), ...moved],
      };
    }
  }

  // Main list in configured order.
  const main: Descriptor[] = [];
  for (const item of config.order) {
    if (item.hidden || item.big) continue;
    const d = take(item.id);
    if (!d) continue;
    main.push({ ...d, name: labelFor(item.id, d, false, item.label) });
  }
  // Drop any items the user hid that are still unconsumed.
  for (const d of flat) {
    const canon = canonicalId(d);
    if (canon && cfg.get(canon)?.hidden) consumed.add(d);
  }
  // Preserve everything else (unknown descriptors) in Slack's order.
  for (const d of flat) if (!consumed.has(d)) main.push(d);

  // Mirror around the cursor: opening below it, the icon row leads; opening
  // above it, the whole menu is reversed so the icon row ends next to it.
  if (config.followCursor && placement === 'down') return [bigGroup, main].filter((g) => g.length);
  if (config.followCursor) main.reverse();
  return [main, bigGroup].filter((g) => g.length);
}
