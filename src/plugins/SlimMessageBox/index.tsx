// Slim down the composer using TextyButtons' own props. The emoji trigger
// stays mounted because it also hosts the native /gif picker.

import { SlickPlugin } from '$slick';
import { COMPACT_CSS, layoutCss, NO_BROADCAST_CSS } from './layout.ts';
import * as meta from './meta.ts';

type TextyButtonsProps = Record<string, unknown>;
type InputContainerProps = { dontShowBroadcastControls?: boolean };
type BroadcastControlsProps = {
  broadcast?: boolean;
  channelType?: string;
  onBroadcastChange?: (event: { target: { checked: boolean } }) => void;
};
type MessageInputProps = { broadcastControls?: React.ReactElement<BroadcastControlsProps> | false };
type Broadcast = { active: boolean; channelType?: string; set(active: boolean): void };

const BUTTON_PROPS: Record<string, string[]> = {
  hideFormatting: ['enableComposerButton'],
  hideEmoji: [],
  hideMention: ['enableMentionButton'],
  hideVideo: ['enableStoryButton'],
  hideAudio: ['enableAudioButton'],
  hideSlash: ['enableSlashCommandsButton', 'enableShortcutsButton'],
};

export default class SlimMessageBox extends SlickPlugin<typeof meta.settings> {
  static readonly requiredAPIs = ['elements'] as const;
  static readonly id = meta.id;
  static readonly pluginName = meta.pluginName;
  static readonly description = meta.description;
  static readonly defaultEnabled = meta.defaultEnabled;
  static readonly settings = meta.settings;

  start() {
    const hidden = Object.keys(BUTTON_PROPS).filter((option) => this.config[option] === true);
    const off = Object.fromEntries(hidden.flatMap((option) => BUTTON_PROPS[option].map((prop) => [prop, false])));

    this.api.setStyle(COMPACT_CSS, 'compact');
    if (this.config.hideEmoji) {
      this.api.setStyle(
        `
        .c-texty_buttons [data-qa="emoji_toolbar_button"] {
          position: absolute !important;
          visibility: hidden !important;
          pointer-events: none !important;
        }
      `,
        'emoji-trigger',
      );
    }

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
    } else if (this.config.broadcastButton) {
      this.installBroadcastButton();
    }

    if (this.config.discordLayout !== false)
      this.api.setStyle(layoutCss(hidden.length, !this.config.broadcastButton || this.config.hideBroadcast), 'layout');
  }

  private installBroadcastButton() {
    const BroadcastContext = React.createContext<Broadcast | null>(null);
    const { Tooltip } = this.api.elements;
    this.api.patchComponent<MessageInputProps>('MessageInput', (Original) => (props) => {
      const controls = props.broadcastControls;
      const { broadcast, channelType, onBroadcastChange } = React.isValidElement(controls) ? controls.props : {};
      const value = React.useMemo(
        () =>
          typeof onBroadcastChange === 'function'
            ? {
                active: !!broadcast,
                channelType,
                set: (active: boolean) => onBroadcastChange({ target: { checked: active } }),
              }
            : null,
        [broadcast, channelType, onBroadcastChange],
      );
      // Keep Slack's control mounted; its callback owns the outgoing broadcast flag.
      // If Slack changes this contract, leave the original checkbox visible.
      return (
        <BroadcastContext.Provider value={value}>
          <Original
            {...props}
            broadcastControls={value ? <span className="slick-slim-broadcast-controls">{controls}</span> : controls}
          />
        </BroadcastContext.Provider>
      );
    });
    this.api.patchComponent<{ children?: React.ReactNode }>('TextyButtonOverflow', (Original) => (props) => {
      const broadcast = React.useContext(BroadcastContext);
      if (!broadcast) return <Original {...props} />;
      const destination =
        broadcast.channelType === 'im'
          ? 'as direct message'
          : broadcast.channelType === 'mpim'
            ? 'to group'
            : 'to channel';
      const label = `Also send ${destination}`;
      return (
        <Original {...props}>
          {props.children}
          <Tooltip tip={broadcast.active ? `Don't send ${destination}` : label} position="top">
            <button
              type="button"
              className="c-button-unstyled c-wysiwyg_container__button slick-slim-broadcast-button"
              aria-label={label}
              aria-pressed={broadcast.active}
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => broadcast.set(!broadcast.active)}
            >
              <svg
                width="18"
                height="18"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.8"
                aria-hidden="true"
              >
                <path d="M4 9h4l10-5v16L8 15H4V9Zm4 6 2 6h3l-2-4.5M21 9v6" strokeLinejoin="round" />
              </svg>
            </button>
          </Tooltip>
        </Original>
      );
    });
    this.api.setStyle(
      `.slick-slim-broadcast-controls { display: none !important; }
       .slick-slim-broadcast-button { display: inline-flex; align-items: center; justify-content: center; width: 32px; height: 32px; }
       .slick-slim-broadcast-button[aria-pressed="true"] { color: var(--dt_color-theme-base-inv-pry, #1264a3); }`,
      'broadcast-button',
    );
  }
}
