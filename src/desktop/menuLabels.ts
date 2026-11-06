import type { MenuItem, MenuItemConstructorOptions } from 'electron';

type MenuEntry = MenuItem | MenuItemConstructorOptions;

export function relabelAppMenu(items: MenuEntry[]) {
  for (const item of items) {
    if (item.role === 'about' || item.role === 'hide' || item.role === 'quit' || item.id === 'menuitem-quit') {
      item.label = item.label?.replace(/\bSlack\b/g, 'Slick');
    }
    const submenu = Array.isArray(item.submenu) ? item.submenu : item.submenu?.items;
    if (submenu) relabelAppMenu(submenu);
  }
}
