// Slack builds the message menu from `MAMenu`'s `actions` prop (a 2-D array of
// descriptor objects). We reshape that array from the user's saved MenuConfig,
// which the "Better Message Menu" settings tab edits. Composes with MessageLogger,
// which only appends its own menu children.

import { SlickPlugin } from '$slick';
import { defaultConfig, type MenuConfig, mergeCatalog } from './config.ts';
import { type EditorHost, MenuEditor } from './editor.tsx';
import * as meta from './meta.ts';
import { applyMenu, BIG_ACTION_CLASS, type ActionGroups, type Placement } from './transform.ts';

type Bounds = { top?: number; bottom?: number; height?: number } | null | undefined;
type ActionsMenuProps = { actions?: ActionGroups; targetBounds?: Bounds; children?: React.ReactNode };
type ConfigStore = { get(): MenuConfig; set(value: MenuConfig): void; use(): MenuConfig };

const STORAGE_KEY = 'menu';

export default class BetterMessageMenu extends SlickPlugin<typeof meta.settings> implements EditorHost {
  static readonly requiredAPIs = ['redux'] as const;
  static readonly id = meta.id;
  static readonly pluginName = meta.pluginName;
  static readonly description = meta.description;
  static readonly category = meta.category;
  static readonly defaultEnabled = meta.defaultEnabled;
  static readonly settings = meta.settings;

  store!: ConfigStore;

  update(next: MenuConfig): void {
    const merged = mergeCatalog(next);
    this.store.set(merged);
    this.api.redux.refresh();
    void this.api.storage.set(STORAGE_KEY, merged).then((ok) => ok || this.log('could not save menu config'));
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
      .p-message_actions_menu .c-menu_item__li:has(.${BIG_ACTION_CLASS}) .c-menu_item__button {
        flex-direction: column;
        align-items: center;
        gap: 4px;
        min-width: 0;
        width: 100%;
        padding: 10px 6px;
        text-align: center;
      }
      .p-message_actions_menu .c-menu_item__li:has(.${BIG_ACTION_CLASS}) .c-menu_item__icon { margin: 0; }
      .p-message_actions_menu .c-menu_item__li:has(.${BIG_ACTION_CLASS}) .c-menu_item__shortcut { display: none; }

      .slick-bmm-editor { display: flex; flex-direction: column; gap: 10px; padding: 14px 16px; }
      .slick-bmm-hint { margin: 0; color: var(--dt_color-content-secondary, #9a9a9a); font-size: 13px; }
      .slick-bmm-cursor { display: flex; align-items: center; gap: 6px; }
      .slick-bmm-list { display: flex; flex-direction: column; gap: 6px; }
      .slick-bmm-row {
        display: flex; align-items: center; gap: 8px;
        padding: 6px 8px; border-radius: 8px;
        border: 1px solid var(--dt_color-otl-ter);
        background: var(--dt_color-surface, #1a1a1a);
      }
      .slick-bmm-row--drag { border-color: var(--dt_color-border-focus, #1d9bd1); opacity: 0.85; }
      .slick-bmm-group { display: flex; flex-direction: column; gap: 6px; margin-top: 6px; }
      .slick-bmm-group-head { display: flex; flex-direction: column; gap: 2px; }
      .slick-bmm-group-title { font-weight: 700; }
      .slick-bmm-group--hidden .slick-bmm-row { opacity: 0.6; }
      .slick-bmm-empty { padding: 8px; font-size: 13px; color: var(--dt_color-content-secondary, #9a9a9a);
        border: 1px dashed var(--dt_color-otl-ter); border-radius: 8px; }
      .slick-bmm-handle { cursor: grab; user-select: none; touch-action: none; padding: 0 2px; color: var(--dt_color-content-secondary, #9a9a9a); }
      .slick-bmm-handle:active { cursor: grabbing; }
      .slick-bmm-name { flex: 1; min-width: 0; padding: 4px 8px;
        border: 1px solid var(--dt_color-otl-ter); border-radius: 6px;
        background: var(--dt_color-input-background, #0f0f0f); color: inherit; }
      .slick-bmm-kind { padding: 4px 8px; border-radius: 6px; cursor: pointer;
        border: 1px solid var(--dt_color-otl-ter);
        background: var(--dt_color-input-background, #0f0f0f); color: inherit; }
      .slick-bmm-reset { align-self: flex-start; padding: 6px 12px; border-radius: 6px; cursor: pointer;
        border: 1px solid var(--dt_color-otl-ter); background: transparent; color: inherit; }
    `);

    this.api.settings.panel(() => <MenuEditor plugin={this} />);

    this.api.patchComponent<ActionsMenuProps>('MAMenu', (Original) => (props) => {
      this.api.redux.usePatchVersion();
      const [height, setHeight] = React.useState(0);
      // Reordering never changes the height, so one measurement settles it before paint.
      React.useLayoutEffect(() => {
        const h = document.querySelector('.p-message_actions_menu')?.getBoundingClientRect().height ?? 0;
        if (Math.abs(h - height) > 1) setHeight(h);
      });
      if (!Array.isArray(props.actions)) return <Original {...props} />;
      const next = applyMenu(props.actions, this.store.get(), this.placement(props.targetBounds, height));
      return <Original {...props} actions={next} />;
    });
  }
}
