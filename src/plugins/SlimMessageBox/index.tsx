// Slim down the composer. Buttons are turned off via TextyButtons' own props,
// not aria-label CSS, which would break in any non-English locale.

import { SlickPlugin } from '$slick';
import { COMPACT_CSS, layoutCss, NO_BROADCAST_CSS } from './layout.ts';
import * as meta from './meta.ts';

type TextyButtonsProps = Record<string, unknown>;
type InputContainerProps = { dontShowBroadcastControls?: boolean };

const BUTTON_PROPS: Record<string, string[]> = {
  hideFormatting: ['enableComposerButton'],
  hideEmoji: ['enableEmojiButton'],
  hideMention: ['enableMentionButton'],
  hideVideo: ['enableStoryButton'],
  hideAudio: ['enableAudioButton'],
  hideSlash: ['enableSlashCommandsButton', 'enableShortcutsButton'],
};

export default class SlimMessageBox extends SlickPlugin<typeof meta.settings> {
  static readonly id = meta.id;
  static readonly pluginName = meta.pluginName;
  static readonly description = meta.description;
  static readonly defaultEnabled = meta.defaultEnabled;
  static readonly settings = meta.settings;

  start() {
    const hidden = Object.keys(BUTTON_PROPS).filter((option) => this.config[option] === true);
    const off = Object.fromEntries(hidden.flatMap((option) => BUTTON_PROPS[option].map((prop) => [prop, false])));

    this.api.setStyle(COMPACT_CSS, 'compact');

    // Slack ships minButtonsForOverflow: 5 against a group of 2, so the
    // overflow menu it has for narrow composers never opens and the buttons
    // just overlap instead.
    this.api.patchComponent<TextyButtonsProps>('TextyButtons', (Original) => (props) => (
      <Original {...props} {...off} minButtonsForOverflow={1} />
    ));

    if (this.config.hideBroadcast) {
      this.api.patchComponent<InputContainerProps>('InputContainer', (Original) => (props) => (
        <Original {...props} dontShowBroadcastControls />
      ));
      this.api.setStyle(NO_BROADCAST_CSS, 'broadcast');
    }

    if (this.config.discordLayout !== false) this.api.setStyle(layoutCss(hidden.length), 'layout');
  }
}
