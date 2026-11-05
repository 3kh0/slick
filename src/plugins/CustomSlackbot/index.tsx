import { SlickPlugin, type SlackStore } from '$slick';
import * as meta from './meta.ts';

const CUSTOM_RESPONSE = '.c-message_kit__background--labels--custom_response';

const cssString = (value: unknown): string => JSON.stringify(String(value));

type ReplyBarAvatarProps = { userId?: string; channelId?: string; threadTs?: string };
type HasCustomResponse = (state: SlackStore, channelId: string, threadTs: string, userId: string) => boolean;

export default class CustomSlackbot extends SlickPlugin<typeof meta.settings> {
  static readonly requiredAPIs = ['redux'] as const;
  static readonly id = meta.id;
  static readonly pluginName = meta.pluginName;
  static readonly description = meta.description;
  static readonly category = meta.category;
  static readonly defaultEnabled = meta.defaultEnabled;
  static readonly settings = meta.settings;
  static readonly liveSettings = ['name', 'url', 'badge'];

  private apply() {
    const name = String(this.config.name ?? '').trim();
    const avatar = String(this.config.url ?? '').trim();

    const rules = [
      '.slick-custom-slackbot-reply-avatar { display: contents; }',
      avatar &&
        `.slick-custom-slackbot-reply-avatar > .c-message__reply_bar_avatar { background-image: url(${cssString(avatar)}) !important; background-size: cover; }`,
      avatar &&
        '.slick-custom-slackbot-reply-avatar > .c-message__reply_bar_avatar > :not(.c-avatar__additional_overlay) { visibility: hidden; }',
      avatar && `${CUSTOM_RESPONSE} .c-message_kit__avatar { background-image: url(${cssString(avatar)}) !important; }`,
      // font-size 0 rather than display:none keeps the button's hit area.
      name && `${CUSTOM_RESPONSE} .c-message__sender_button { font-size: 0 !important; }`,
      name && `${CUSTOM_RESPONSE} .c-message__sender_button::after { content: ${cssString(name)}; font-size: 15px; }`,
      this.config.badge && `${CUSTOM_RESPONSE} [data-qa="custom_response_info_badge"] { display: none !important; }`,
    ].filter(Boolean);

    this.api.setStyle(rules.join('\n'));
  }

  start() {
    this.apply();
    this.api.patchComponent<ReplyBarAvatarProps>('ReplyBarAvatar', (Original) => {
      const hasCustomResponse = this.api.getExport<HasCustomResponse>(
        (value: unknown) => typeof value === 'function' && value.name === 'hasSlackbotCustomResponseInThread',
      );
      return (props) => {
        const customResponse = this.api.redux.useReduxState((state) =>
          props.userId === 'USLACKBOT' && props.channelId && props.threadTs
            ? hasCustomResponse?.(state, props.channelId, props.threadTs, props.userId)
            : false,
        );
        const avatar = <Original {...props} />;
        return customResponse ? <span className="slick-custom-slackbot-reply-avatar">{avatar}</span> : avatar;
      };
    });
  }

  onSettingsChange() {
    this.apply();
  }
}
