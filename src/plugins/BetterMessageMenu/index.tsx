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

  /** The menu opens downward unless its trigger sits low in the viewport. */
  private placement(bounds: Bounds): Placement {
    const edge =
      bounds?.bottom ?? (bounds?.top != null && bounds?.height != null ? bounds.top + bounds.height : undefined);
    if (typeof edge !== 'number' || typeof innerHeight !== 'number') return 'down';
    return edge > innerHeight * 0.6 ? 'up' : 'down';
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

      .slick-bmm-editor { display: flex; flex-direction: column; gap: 10px; }
      .slick-bmm-hint { margin: 0; color: var(--dt_color-content-secondary, #9a9a9a); font-size: 13px; }
      .slick-bmm-cursor { display: flex; align-items: center; gap: 6px; }
      .slick-bmm-list { display: flex; flex-direction: column; gap: 6px; }
      .slick-bmm-row {
        display: flex; align-items: center; gap: 8px;
        padding: 6px 8px; border-radius: 8px;
        border: 1px solid var(--dt_color-border, #3a3a3a);
        background: var(--dt_color-surface, #1a1a1a);
      }
      .slick-bmm-row--drag { border-color: var(--dt_color-border-focus, #1d9bd1); opacity: 0.85; }
      .slick-bmm-row--off { opacity: 0.55; }
      .slick-bmm-handle { cursor: grab; user-select: none; touch-action: none; padding: 0 2px; color: var(--dt_color-content-secondary, #9a9a9a); }
      .slick-bmm-handle:active { cursor: grabbing; }
      .slick-bmm-name { flex: 1; min-width: 0; padding: 4px 8px;
        border: 1px solid var(--dt_color-border, #3a3a3a); border-radius: 6px;
        background: var(--dt_color-input-background, #0f0f0f); color: inherit; }
      .slick-bmm-opt { display: inline-flex; align-items: center; gap: 4px; font-size: 13px; white-space: nowrap; }
      .slick-bmm-reset { align-self: flex-start; padding: 6px 12px; border-radius: 6px; cursor: pointer;
        border: 1px solid var(--dt_color-border, #3a3a3a); background: transparent; color: inherit; }
    `);

    this.api.settings.panel(() => <MenuEditor plugin={this} />);

    this.api.patchComponent<ActionsMenuProps>('MAMenu', (Original) => (props) => {
      this.api.redux.usePatchVersion();
      if (!Array.isArray(props.actions)) return <Original {...props} />;
      const next = applyMenu(props.actions, this.store.get(), this.placement(props.targetBounds));
      return <Original {...props} actions={next} />;
    });
  }
}
