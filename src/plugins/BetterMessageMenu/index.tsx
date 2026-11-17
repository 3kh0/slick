// Slack builds the message menu from `MAMenu`'s `actions` prop (a 2-D array of
// descriptor objects). We reshape that array from the user's saved MenuConfig,
// which the "Better Message Menu" settings tab edits. Composes with MessageLogger,
// which only appends its own menu children.

import { SlickPlugin } from '$slick';
import { defaultConfig, discoverActions, type MenuConfig, mergeCatalog } from './config.ts';
import { type EditorHost, MenuEditor } from './editor.tsx';
import * as meta from './meta.ts';
import { applyMenu, BIG_ACTION_CLASS, type ActionGroups, type Placement } from './transform.ts';

type Bounds = { top?: number; bottom?: number; height?: number } | null | undefined;
type ActionsMenuProps = {
  actions?: ActionGroups;
  targetBounds?: Bounds;
  children?: React.ReactNode;
  channelId?: string;
  ts?: string;
  slickMessageActionsHandled?: boolean;
  autoClogProps?: { uiComponentName?: string };
  renderMenuItem?: (props: any) => React.ReactNode;
};
type ConfigStore = { get(): MenuConfig; set(value: MenuConfig): void; use(): MenuConfig };

const STORAGE_KEY = 'menu';

export default class BetterMessageMenu extends SlickPlugin<typeof meta.settings> implements EditorHost {
  static readonly requiredAPIs = ['redux', 'menu'] as const;
  static readonly id = meta.id;
  static readonly pluginName = meta.pluginName;
  static readonly description = meta.description;
  static readonly category = meta.category;
  static readonly defaultEnabled = meta.defaultEnabled;
  static readonly settings = meta.settings;

  private readonly Organize = React.createContext<{
    actions: ActionGroups[number];
    render?: (props: any) => React.ReactNode;
  } | null>(null);
  private readonly InOrganize = React.createContext(false);
  store!: ConfigStore;
  private writes: Promise<unknown> = Promise.resolve();

  update(next: MenuConfig): void {
    const merged = mergeCatalog(next);
    this.store.set(merged);
    this.api.redux.refresh();
    this.writes = this.writes
      .then(async () => {
        if (!(await this.api.storage.set(STORAGE_KEY, merged))) this.log('could not save menu config');
      })
      .catch((error) => this.log(`could not save menu config: ${String(error)}`));
  }

  // Slack's ContextMenu Popover ("right-bottom", tryOppositePosition, 10px
  // allowance) flips above the cursor only when below overflows and above fits.
  private placement(bounds: Bounds, height: number): Placement {
    const top = bounds?.top;
    if (typeof top !== 'number' || !height) return 'down';
    const allowance = 10;
    return top + height > innerHeight - allowance && top - height >= allowance ? 'up' : 'down';
  }

  async start() {
    const stored = await this.api.storage.get<MenuConfig | undefined>(STORAGE_KEY, undefined);
    if (!this.api.isActive()) return;
    this.store = new this.api.Store<MenuConfig>(mergeCatalog(stored ?? defaultConfig()));

    this.api.setStyle(`
      .p-message_actions_menu .c-menu_item__li:has(.${BIG_ACTION_CLASS}) {
        display: inline-flex;
        width: calc(100% / 3);
        box-sizing: border-box;
        vertical-align: top;
      }
      .p-message_actions_menu .c-menu_item__li:has(.${BIG_ACTION_CLASS}-n1) { width: 100%; }
      .p-message_actions_menu .c-menu_item__li:has(.${BIG_ACTION_CLASS}-n2) { width: 50%; }
      .p-message_actions_menu .c-submenu:has(> .c-menu_item__li > .${BIG_ACTION_CLASS}) { display: inline-flex; width: calc(100% / 3); vertical-align: top; }
      .p-message_actions_menu .c-submenu:has(> .c-menu_item__li > .${BIG_ACTION_CLASS}-n1) { width: 100%; }
      .p-message_actions_menu .c-submenu:has(> .c-menu_item__li > .${BIG_ACTION_CLASS}-n2) { width: 50%; }
      .p-message_actions_menu .c-submenu > .c-menu_item__li:has(> .${BIG_ACTION_CLASS}) { width: 100%; }
      .p-message_actions_menu .c-menu_item__button.${BIG_ACTION_CLASS} {
        flex-direction: column;
        align-items: center;
        gap: 4px;
        min-width: 0;
        width: 100%;
        padding: 10px 6px;
        text-align: center;
      }
      .p-message_actions_menu .${BIG_ACTION_CLASS} .c-menu_item__icon { margin: 0; }
      .p-message_actions_menu .${BIG_ACTION_CLASS} .c-menu_item__shortcut { display: none; }

      .slick-bmm-editor { display: flex; flex-direction: column; gap: 10px; padding: 14px 16px; }
      .slick-bmm-hint { margin: 0; color: var(--dt_color-content-sec, #9a9a9a); font-size: 13px; }
      .slick-bmm-cursor { display: flex; align-items: center; gap: 6px; }
      .slick-bmm-list { display: flex; flex-direction: column; gap: 6px; }
      .slick-bmm-row {
        display: flex; align-items: center; gap: 8px;
        padding: 6px 8px; border-radius: 8px;
        border: 1px solid var(--dt_color-otl-ter);
        background: var(--dt_color-base-sec, #f8f8f8);
      }
      .slick-bmm-row--drag { border-color: var(--dt_color-content-hgl-1, #1d9bd1); opacity: 0.85; }
      .slick-bmm-group { display: flex; flex-direction: column; gap: 6px; margin-top: 6px; }
      .slick-bmm-group-head { display: flex; flex-direction: column; gap: 2px; }
      .slick-bmm-group-title { font-weight: 700; }
      .slick-bmm-group--hidden .slick-bmm-row { opacity: 0.6; }
      .slick-bmm-empty { padding: 8px; font-size: 13px; color: var(--dt_color-content-sec, #9a9a9a);
        border: 1px dashed var(--dt_color-otl-ter); border-radius: 8px; }
      .slick-bmm-order { display: inline-flex; flex: none; }
      .slick-bmm-order button { border: 0; background: transparent; color: inherit; border-radius: 4px; padding: 4px; cursor: pointer; }
      .slick-bmm-order button:hover { background: var(--dt_color-surf-pry-hover, #8882); }
      .slick-bmm-order button:disabled { opacity: .3; cursor: default; }
      .slick-bmm-announcement { position: absolute; width: 1px; height: 1px; overflow: hidden; clip-path: inset(50%); }
      .slick-bmm-handle { cursor: grab; user-select: none; touch-action: none; padding: 0 2px; color: var(--dt_color-content-sec, #9a9a9a); }
      .slick-bmm-handle:active { cursor: grabbing; }
      .slick-bmm-label { display: flex; flex: 1; align-items: center; gap: 6px; min-width: 0; min-height: 28px; }
      .slick-bmm-label > span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
      .slick-bmm-rename { display: inline-flex; align-items: center; justify-content: center; flex: none; padding: 5px; border: 0; border-radius: 4px; background: transparent; color: inherit; opacity: .6; cursor: pointer; }
      .slick-bmm-rename:hover, .slick-bmm-rename:focus-visible { opacity: 1; background: var(--dt_color-surf-pry-hover, #8882); }
      .slick-bmm-name { flex: 1; min-width: 0; padding: 4px 8px;
        border: 1px solid var(--dt_color-otl-ter); border-radius: 6px;
        background: var(--dt_color-base-pry, #fff); color: inherit; }
      .slick-bmm-kind { max-width: 160px; padding: 4px 8px; border-radius: 6px; cursor: pointer;
        border: 1px solid var(--dt_color-otl-ter);
        background: var(--dt_color-base-pry, #fff); color: inherit; }
      .slick-bmm-reset { align-self: flex-start; padding: 6px 12px; border-radius: 6px; cursor: pointer;
        border: 1px solid var(--dt_color-otl-ter); background: transparent; color: inherit; }
    `);

    this.api.settings.panel(() => <MenuEditor plugin={this} />);

    this.api.patchComponent('OrganizeMessageActionsSubmenu', (Original) => (props) => (
      <this.InOrganize.Provider value={true}>
        <Original {...props} />
      </this.InOrganize.Provider>
    ));

    this.api.patchComponent<ActionsMenuProps>('MAMenu', (Original) => (props) => {
      this.api.redux.usePatchVersion();
      const [height, setHeight] = React.useState(0);
      const organize = React.useContext(this.Organize);
      const inOrganize = React.useContext(this.InOrganize);
      const root = props.autoClogProps?.uiComponentName === 'message_actions_menu';
      // Reordering never changes the height, so one measurement settles it before paint.
      React.useLayoutEffect(() => {
        if (!root) return;
        const h = document.querySelector('.p-message_actions_menu')?.getBoundingClientRect().height ?? 0;
        if (Math.abs(h - height) > 1) setHeight(h);
        const onKey = (event: KeyboardEvent) => {
          if (!this.store.get().vimKeys || event.ctrlKey || event.metaKey || event.altKey) return;
          const target = event.target as Element | null;
          if (!target?.closest('[role=menu]') || target.closest('input,textarea,select,[contenteditable=true]')) return;
          const mapped = (
            { j: ['ArrowDown', 40], k: ['ArrowUp', 38], h: ['ArrowLeft', 37], l: ['ArrowRight', 39] } as const
          )[event.key as 'j'];
          if (!mapped) return;
          event.preventDefault();
          event.stopImmediatePropagation();
          target.dispatchEvent(
            new KeyboardEvent('keydown', {
              key: mapped[0],
              code: mapped[0],
              keyCode: mapped[1],
              which: mapped[1],
              bubbles: true,
              cancelable: true,
            }),
          );
        };
        document.addEventListener('keydown', onKey, true);
        return () => document.removeEventListener('keydown', onKey, true);
      });
      if (inOrganize && organize)
        return (
          <this.InOrganize.Provider value={false}>
            <Original
              {...props}
              actions={[organize.actions]}
              renderMenuItem={organize.render ?? props.renderMenuItem}
              slickMessageActionsHandled
            />
          </this.InOrganize.Provider>
        );
      if (!root || !Array.isArray(props.actions)) return <Original {...props} />;
      const custom = this.api.menu.getMessageActions(props);
      const existing = new Set(props.actions.flat().map((action) => action.id));
      const actions = [...props.actions, custom.filter((action) => !existing.has(action.id))];
      const config = discoverActions(this.store.get(), actions);
      if (config !== this.store.get())
        queueMicrotask(() => {
          if (!this.api.isActive()) return;
          const current = this.store.get();
          const discovered = discoverActions(current, actions);
          if (discovered !== current) this.update(discovered);
        });
      const next = applyMenu(actions, config, this.placement(props.targetBounds, height));
      const renderMenuItem = (args: any) => {
        const rendered = props.renderMenuItem?.(args);
        if (
          !React.isValidElement<{ className?: string; icon?: unknown }>(rendered) ||
          !args.className?.includes(BIG_ACTION_CLASS)
        )
          return rendered;
        return React.cloneElement(rendered, { className: args.className, icon: rendered.props.icon ?? args.icon });
      };
      const children = next.flat().find((action) => action.id === 'organize_actions_menu')?.submenuActions ?? [];
      return (
        <this.Organize.Provider value={{ actions: children, render: renderMenuItem }}>
          <Original {...props} actions={next} renderMenuItem={renderMenuItem} slickMessageActionsHandled />
        </this.Organize.Provider>
      );
    });
  }
}
