import { SlickPlugin } from '$slick';
import * as meta from './meta.ts';

type SlugProps = { id?: string; supressMentionAtSymbol?: boolean };

export default class MentionProfiles extends SlickPlugin<typeof meta.settings> {
  static readonly requiredAPIs = ['members'] as const;
  static readonly id = meta.id;
  static readonly pluginName = meta.pluginName;
  static readonly description = meta.description;
  static readonly defaultEnabled = meta.defaultEnabled;
  static readonly settings = meta.settings;
  static readonly liveSettings = ['showAtSymbol'];

  private readonly active = new this.api.Store(false);
  private readonly hideAt = new this.api.Store(false);

  start() {
    this.active.set(true);
    this.api.signal.addEventListener('abort', () => this.active.set(false), { once: true });
    this.onSettingsChange();

    this.api.setStyle(`
      .slick-mention-profile .c-member_slug::before {
        content: '';
        display: inline-block;
        width: 1em;
        height: 1em;
        margin: 0 3px 0.2em 1px;
        border-radius: 50%;
        background: var(--slick-mention-profile) center / cover;
        vertical-align: middle;
      }
    `);

    this.api.patchComponent<SlugProps>('MemberSlug', (Original) => (props) => {
      const active = this.active.use();
      const hideAt = this.hideAt.use();
      const member = this.api.members.useMember(active ? (props.id ?? '') : '');
      const image = member?.profile?.image_48 ?? member?.profile?.image_24;
      if (!active) return <Original {...props} />;
      const slug = <Original {...props} supressMentionAtSymbol={props.supressMentionAtSymbol || hideAt} />;
      if (!image) return slug;
      return (
        <span
          className="slick-mention-profile"
          style={{ '--slick-mention-profile': `url(${JSON.stringify(image)})` } as React.CSSProperties}
        >
          {slug}
        </span>
      );
    });
  }

  onSettingsChange() {
    this.hideAt.set(this.config.showAtSymbol === false);
  }
}
