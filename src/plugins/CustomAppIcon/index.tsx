import { SlickPlugin } from '$slick';
import { IconGrid, type IconGridHost } from './IconGrid.tsx';
import type { ImportResult, Theme } from './icons.ts';
import * as meta from './meta.ts';
import * as webTarget from './web.tsx';

type Store<T> = { get(): T; set(value: T): void; use(): T };

const CUSTOM_KEY = 'custom';

export default class CustomAppIcon extends SlickPlugin<typeof meta.settings> implements IconGridHost {
  static readonly requiredAPIs = ['redux'] as const;
  static readonly id = meta.id;
  static readonly pluginName = meta.pluginName;
  static readonly description = meta.description;
  static readonly category = meta.category;
  static readonly authors = meta.authors;
  static readonly defaultEnabled = meta.defaultEnabled;
  static readonly settings = meta.settings;
  static readonly liveSettings = ['icon', 'appearance'];

  selection!: Store<string>;
  appearance!: Store<string>;
  theme!: Store<Theme>;
  custom!: Store<string | null>;
  web: typeof webTarget | null = null;

  start() {
    const web = (this.web = this.api.loader === 'electron' ? null : webTarget);
    this.selection = new this.api.Store(String(this.config.icon));
    this.appearance = new this.api.Store(String(this.config.appearance));
    this.theme = new this.api.Store<Theme>(web ? web.browserTheme() : 'light');
    if (web) this.startWeb(web);
    else {
      this.api.main.on('theme-changed', (theme) => this.theme.set(theme as Theme));
      void this.call<Theme>('theme').then((theme) => {
        if (theme && this.api.isActive()) this.theme.set(theme);
      });
    }
    this.api.setStyle(STYLE);
    this.api.settings.panel(() => <IconGrid host={this} />);
  }

  stop() {
    this.web?.clearBadges();
  }

  private startWeb(tab: typeof webTarget) {
    this.custom = new this.api.Store<string | null>(null);
    void this.loadCustom().then((image) => this.api.isActive() && this.custom.set(image));
    tab.onBrowserTheme((theme) => this.theme.set(theme), this.api.signal);
    const state = tab.faviconState(this.api.getExport);
    this.api.patchComponent<{ href?: string }>('Favicon', (Original) => (props) => {
      const icon = this.selection.use();
      const theme = this.themeFor(this.appearance.use(), this.theme.use());
      const custom = this.custom.use();
      const source = icon === 'custom' ? custom : tab.TAB_ICONS[tab.TAB_ALIASES[icon] ?? icon]?.[theme];
      const href = tab.useTabIcon(source, this.api.redux.useReduxState(state));
      return <Original {...props} href={href ?? props.href} />;
    });
  }

  private themeFor(appearance: string, theme: Theme): Theme {
    return appearance === 'light' || appearance === 'dark' ? appearance : theme;
  }

  private loadCustom() {
    return this.api.storage.get<string | null>(CUSTOM_KEY, null);
  }

  onSettingsChange() {
    this.selection.set(String(this.config.icon));
    this.appearance.set(String(this.config.appearance));
  }

  loadPreviews(appearance: string) {
    const web = this.web;
    if (!web) return this.call<Record<string, string>>('previews', appearance);
    const theme = this.themeFor(appearance, this.theme.get());
    return Promise.resolve(
      Object.fromEntries(Object.entries(web.TAB_ICONS).map(([id, images]) => [id, images[theme]])),
    );
  }

  loadCustomPreview() {
    return this.web ? this.loadCustom() : this.call<string | null>('customPreview');
  }

  async choose(icon: string) {
    if (icon !== this.config.icon) await this.api.settings.set('icon', icon);
  }

  async upload(): Promise<ImportResult> {
    const web = this.web;
    const result = web
      ? await this.importWeb(web, web.pickImage())
      : ((await this.call<ImportResult>('importCustom')) ?? 'failed');
    if (result === 'saved' && this.api.isActive()) await this.choose('custom');
    return result;
  }

  async removeCustom(): Promise<boolean> {
    if (this.config.icon === 'custom') await this.choose('slick');
    if (!this.web) return (await this.call<boolean>('removeCustom')) ?? false;
    if (!(await this.api.storage.delete(CUSTOM_KEY))) return false;
    this.custom.set(null);
    return true;
  }

  private async importWeb(tab: typeof webTarget, file: Promise<File | null>): Promise<ImportResult> {
    const { result, image } = await tab.importImage(await file);
    if (!image) return result;
    if (!(await this.api.storage.set(CUSTOM_KEY, image))) return 'failed';
    this.custom.set(image);
    return result;
  }

  private async call<T>(method: string, ...args: unknown[]): Promise<T | null> {
    try {
      return await this.api.main.call<T>(method, ...args);
    } catch (error) {
      this.log(`${method} failed`, error);
      return null;
    }
  }
}

const STYLE = `
.slick-app-icons { display: grid; grid-template-columns: repeat(auto-fill, minmax(112px, 1fr)); gap: 12px; padding: 12px; }
.slick-app-icons__tile {
  display: flex; flex-direction: column; align-items: center; gap: 4px; padding: 12px 8px;
  border: 1px solid var(--dt_color-otl-ter); border-radius: 12px; background: transparent; color: inherit;
  font: inherit; text-align: center; cursor: pointer;
}
.slick-app-icons__tile:hover { background: var(--dt_color-base-pry-hover); }
.slick-app-icons__tile[aria-checked="true"] { border-color: var(--dt_color-otl-hgl-1); box-shadow: 0 0 0 1px var(--dt_color-otl-hgl-1); }
.slick-app-icons__image { width: 64px; height: 64px; object-fit: contain; }
.slick-app-icons__placeholder {
  display: grid; place-items: center; width: 64px; height: 64px; border-radius: 14px;
  border: 1px dashed var(--dt_color-otl-sec); color: var(--dt_color-content-sec); font-size: 28px;
}
.slick-app-icons__label { font-weight: 700; color: var(--dt_color-content-pry); }
.slick-app-icons__detail { font-size: 12px; color: var(--dt_color-content-sec); }
.slick-app-icons__status { margin: 0 12px 12px; color: var(--dt_color-content-destructive); }
.slick-app-icons__menu {
  position: fixed; inset: unset; margin: 0; min-width: 180px; padding: 4px; border: 1px solid var(--dt_color-otl-ter);
  border-radius: 6px; background: var(--dt_color-base-pry); color: var(--dt_color-content-pry); box-shadow: 0 4px 16px #0003;
}
.slick-app-icons__menu button {
  display: block; width: 100%; padding: 6px 12px; border: 0; border-radius: 3px; text-align: left;
  background: transparent; color: var(--dt_color-content-destructive); font: inherit;
}
.slick-app-icons__menu button:is(:hover, :focus-visible) { background: var(--dt_color-base-hgl-1); outline: none; }
`;
