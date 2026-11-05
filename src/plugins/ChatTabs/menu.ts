import type { MenuTemplateItem } from '$slick';

export function addTabMenuItem(template: MenuTemplateItem[], open: () => void): MenuTemplateItem[] {
  if (template.some((item) => item.key === 'slick-chat-tabs-open')) return template;
  const anchor = template.findIndex((item) => typeof item.label === 'string' && /open in new window/i.test(item.label));
  const index = anchor < 0 ? template.findIndex((item) => item.danger) : anchor + 1;
  const next = [...template];
  next.splice(index < 0 ? next.length : index, 0, {
    key: 'slick-chat-tabs-open',
    label: 'Open in new Slick tab',
    click: open,
  });
  return next;
}

export const THREAD_TAB_ACTION = 'slick-chat-tabs-open-thread';
export type MessageAction = { id: string; name?: string; [key: string]: unknown };

export function addThreadTabAction(groups: MessageAction[][]): MessageAction[][] {
  if (groups.some((group) => group.some((action) => action.id === THREAD_TAB_ACTION))) return groups;
  const action = {
    id: THREAD_TAB_ACTION,
    name: 'Open in new Slick tab',
    icon: 'threads',
    'data-qa': THREAD_TAB_ACTION,
  };
  const groupIndex = groups.findIndex((group) =>
    group.some((item) => typeof item.name === 'string' && /reply to thread/i.test(item.name)),
  );
  if (groupIndex < 0) return [[action], ...groups];
  return groups.map((group, index) => {
    if (index !== groupIndex) return group;
    const anchor = group.findIndex((item) => typeof item.name === 'string' && /reply to thread/i.test(item.name));
    return [...group.slice(0, anchor + 1), action, ...group.slice(anchor + 1)];
  });
}
