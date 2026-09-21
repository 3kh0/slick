// Opening one of Slack's own popup menus from a trigger a plugin supplies.
//
// Slack's menu is a render-prop component, which is awkward to use from a
// plugin; this reduces it to "here is a template, here is what opens it".

import { reactReady } from '../slack/react.tsx';
import { elementsReady, type MenuTemplateItem } from './elements.ts';

export type { MenuTemplateItem };

export type MenuProps = {
  template: MenuTemplateItem[];
  position?: 'top' | 'bottom' | 'left' | 'right';
  /** The element that opens the menu. */
  children?: React.ReactNode;
};

export const menuReady = (async () => {
  await reactReady;
  const { MenuTrigger, MenuFromTemplate } = await elementsReady;

  function Menu({ template, position, children }: MenuProps) {
    return (
      <MenuTrigger
        position={position}
        renderMenu={(menuProps) => <MenuFromTemplate {...menuProps} template={template} />}
      >
        {children}
      </MenuTrigger>
    );
  }

  return { Menu };
})();

export type MenuAPI = Awaited<typeof menuReady>;
