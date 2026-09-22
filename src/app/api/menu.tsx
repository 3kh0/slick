// Opening a popup menu from a trigger a plugin supplies.
//
// This owns the small accessible menu surface rather than depending on the
// unverified props of Slack's private MenuFromTemplate component.

import { reactReady } from '../slack/react.tsx';
import type { MenuTemplateItem } from './elements.ts';

export type { MenuTemplateItem };

export type MenuProps = {
  template: MenuTemplateItem[];
  position?: 'top' | 'bottom' | 'left' | 'right';
  /** The element that opens the menu. */
  children?: React.ReactNode;
};

export const menuReady = (async () => {
  await reactReady;

  function Menu({ template, position, children }: MenuProps) {
    const [open, setOpen] = React.useState(false);
    const root = React.useRef<HTMLSpanElement>(null);
    const popup = React.useRef<HTMLDivElement>(null);

    React.useEffect(() => {
      if (!open) return;
      const anchor = root.current?.getBoundingClientRect();
      const menu = popup.current;
      if (anchor && menu) {
        try {
          menu.showPopover?.();
        } catch (error) {
          console.error('[slick] menu popover could not open:', error);
        }
        const box = menu.getBoundingClientRect();
        const gap = 4;
        const [top, left] =
          position === 'top'
            ? [anchor.top - box.height - gap, anchor.left]
            : position === 'left'
              ? [anchor.top, anchor.left - box.width - gap]
              : position === 'right'
                ? [anchor.top, anchor.right + gap]
                : [anchor.bottom + gap, anchor.left];
        menu.style.top = `${Math.max(gap, Math.min(top, innerHeight - box.height - gap))}px`;
        menu.style.left = `${Math.max(gap, Math.min(left, innerWidth - box.width - gap))}px`;
      }
      const dismiss = (event: MouseEvent) => {
        if (!root.current?.contains(event.target as Node)) setOpen(false);
      };
      const escape = (event: KeyboardEvent) => {
        if (event.key === 'Escape') setOpen(false);
      };
      document.addEventListener('mousedown', dismiss);
      document.addEventListener('keydown', escape);
      root.current?.querySelector<HTMLButtonElement>('[role="menuitem"]')?.focus();
      return () => {
        try {
          menu?.hidePopover?.();
        } catch {}
        document.removeEventListener('mousedown', dismiss);
        document.removeEventListener('keydown', escape);
      };
    }, [open, position]);

    const rows = (items: MenuTemplateItem[]): React.ReactNode =>
      items.map((item) => {
        if (item.type === 'separator') return <hr key={item.key} role="separator" />;
        if (item.type === 'header')
          return (
            <div key={item.key} role="presentation" style={{ padding: '6px 12px', fontWeight: 700 }}>
              {item.label}
            </div>
          );
        if (item.type === 'submenu')
          return (
            <details key={item.key}>
              <summary style={{ padding: '6px 12px' }}>{item.label}</summary>
              <div role="menu">{rows(item.template ?? [])}</div>
            </details>
          );
        return (
          <button
            key={item.key}
            type="button"
            role="menuitem"
            disabled={item.disabled}
            onClick={(event) => {
              try {
                item.click?.(event);
              } catch (error) {
                console.error(`[slick] menu item ${item.key} failed:`, error);
              } finally {
                setOpen(false);
              }
            }}
            style={{
              display: 'block',
              width: '100%',
              padding: '6px 12px',
              border: 0,
              background: 'transparent',
              color: item.danger ? 'var(--dt_color-content-destructive)' : 'inherit',
              textAlign: 'left',
            }}
          >
            {item.label}
            {item.description && <small style={{ display: 'block' }}>{item.description}</small>}
          </button>
        );
      });

    return (
      <span
        ref={root}
        style={{ display: 'inline-flex', position: 'relative' }}
        onClick={() => setOpen((shown) => !shown)}
      >
        {children}
        {open && (
          <div
            ref={popup}
            popover="manual"
            role="menu"
            style={{
              inset: 'unset',
              position: 'fixed',
              zIndex: 1000,
              minWidth: 180,
              padding: 4,
              border: '1px solid var(--dt_color-otl-ter)',
              borderRadius: 6,
              background: 'var(--dt_color-surf-pry)',
              boxShadow: '0 4px 16px #0003',
            }}
            onClick={(event) => event.stopPropagation()}
          >
            {rows(template)}
          </div>
        )}
      </span>
    );
  }

  return { Menu };
})();

export type MenuAPI = Awaited<typeof menuReady>;
