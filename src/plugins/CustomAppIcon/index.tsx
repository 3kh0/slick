import { SlickPlugin } from '$slick';
import { IconGrid, type IconGridHost } from './IconGrid.tsx';
import type { ImportResult } from './icons.ts';
import * as meta from './meta.ts';

type IconStore = { get(): string; set(value: string): void; use(): string };

export default class CustomAppIcon extends SlickPlugin<typeof meta.settings> implements IconGridHost {
  static readonly requiredAPIs = [] as const;
  static readonly id = meta.id;
  static readonly pluginName = meta.pluginName;
  static readonly description = meta.description;
  static readonly category = meta.category;
  static readonly authors = meta.authors;
  static readonly defaultEnabled = meta.defaultEnabled;
  static readonly settings = meta.settings;
  static readonly liveSettings = ['icon'];

  selection!: IconStore;

  start() {
    this.selection = new this.api.Store(String(this.config.icon));
    this.api.setStyle(STYLE);
    this.api.settings.panel(() => <IconGrid host={this} />);
  }

  onSettingsChange() {
    this.selection.set(String(this.config.icon));
  }

  loadPreviews() {
    return this.call<Record<string, string>>('previews');
  }

  loadCustomPreview() {
    return this.call<string | null>('customPreview');
  }

  async choose(icon: string) {
    if (icon !== this.config.icon) await this.api.settings.set('icon', icon);
  }

  async upload(): Promise<ImportResult> {
    const result = (await this.call<ImportResult>('importCustom')) ?? 'failed';
    if (result === 'saved' && this.api.isActive()) await this.choose('custom');
    return result;
  }

  async removeCustom(): Promise<boolean> {
    if (this.config.icon === 'custom') await this.choose('slick');
    return (await this.call<boolean>('removeCustom')) ?? false;
  }

  private async call<T>(method: string): Promise<T | null> {
    try {
      return await this.api.main.call<T>(method);
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
