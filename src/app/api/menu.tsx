// Owns its menu markup rather than depend on the unverified props of Slack's
// private MenuFromTemplate.

import { patchComponent, reactReady } from '../slack/react.tsx';
import { reduxReady } from '../slack/redux.ts';
import type { MenuTemplateItem } from './elements.ts';

export type { MenuTemplateItem };

export type MenuProps = {
  template: MenuTemplateItem[];
  position?: 'top' | 'bottom' | 'left' | 'right';
  /** The element that opens the menu. */
  children?: React.ReactNode;
};

export type MessageMenuContext = { channelId?: string; ts?: string; threadTs?: string };
export type MessageMenuAction = { id: string; name: string; icon?: string; 'data-qa'?: string; onSelect: () => void };
type MessageMenuProps = MessageMenuContext & {
  actions?: (Record<string, any> & { id?: string; submenuActions?: Record<string, any>[] })[][];
  slickMessageActionsHandled?: boolean;
  autoClogProps?: { uiComponentName?: string };
  onSelectAction?: (...args: any[]) => unknown;
  onTriggerClose?: (event?: unknown) => void;
};
const messageActions = new Set<(context: MessageMenuContext) => MessageMenuAction[]>();

function addMessageActions(provider: (context: MessageMenuContext) => MessageMenuAction[]): () => void {
  messageActions.add(provider);
  return () => {
    messageActions.delete(provider);
  };
}

function getMessageActions(context: MessageMenuContext): MessageMenuAction[] {
  const actions = new Map<string, MessageMenuAction>();
  for (const provider of messageActions) {
    try {
      for (const action of provider(context))
        actions.set(action.id, { ...action, 'data-qa': action['data-qa'] ?? action.id });
    } catch (error) {
      console.error('[slick] message menu provider failed:', error);
    }
  }
  return [...actions.values()];
}

export const menuReady = (async () => {
  await reactReady;
  const { usePatchVersion } = await reduxReady;
  patchComponent<MessageMenuProps>('MAMenu', (Original) => (props) => {
    usePatchVersion();
    const { slickMessageActionsHandled, ...nativeProps } = props;
    const custom = getMessageActions(props);
    if (!custom.length || !Array.isArray(props.actions)) return <Original {...nativeProps} />;
    const ids = new Set(
      props.actions.flat().flatMap((action) => [action.id, ...(action.submenuActions ?? []).map((child) => child.id)]),
    );
    const added =
      slickMessageActionsHandled || props.autoClogProps?.uiComponentName !== 'message_actions_menu'
        ? []
        : custom.filter((action) => !ids.has(action.id));
    return (
      <Original
        {...nativeProps}
        actions={added.length ? [...props.actions, added] : props.actions}
        onSelectAction={(event, action, ...rest) => {
          const selected = custom.find((item) => item.id === action.id);
          if (!selected) return props.onSelectAction?.(event, action, ...rest);
          try {
            selected.onSelect();
          } finally {
            props.onTriggerClose?.(event);
          }
          return true;
        }}
      />
    );
  });

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

  return { Menu, addMessageActions, getMessageActions };
})();

export type MenuAPI = Awaited<typeof menuReady>;
