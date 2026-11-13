import { SlickPlugin } from '$slick';
import * as meta from './meta.ts';

const CHANGELOG_URL = 'https://github.com/3kh0/slick/releases';

export default class Changelog extends SlickPlugin<typeof meta.settings> {
  static readonly requiredAPIs = ['elements'] as const;
  static readonly id = meta.id;
  static readonly pluginName = meta.pluginName;
  static readonly description = meta.description;
  static readonly category = meta.category;
  static readonly defaultEnabled = meta.defaultEnabled;
  static readonly settings = meta.settings;

  start() {
    const { Tooltip, SvgIcon } = this.api.elements;

    this.api.patchComponent<Record<string, unknown>>('HelpButton', (Original) => (props) => (
      <>
        <div className="p-top_nav__windows_controls_container slick-changelog__container">
          <Tooltip tip="Slick changelog" position="bottom" delay={500}>
            <button
              type="button"
              className="c-button-unstyled p-top_nav__button p-top_nav__help slick-changelog__button"
              aria-label="Open the Slick changelog"
              onClick={() => window.open(CHANGELOG_URL, '_blank', 'noopener')}
            >
              <SvgIcon name="list-view" size={20} />
            </button>
          </Tooltip>
        </div>
        <Original {...props} />
      </>
    ));
  }
}
