import { SlickPlugin, type SlackChannel } from '$slick';
import { humanCount, type MembershipCounts } from './count.ts';
import * as meta from './meta.ts';

type AvatarStackProps = { channelId?: string; memberCount?: number };

export default class HumanCount extends SlickPlugin<typeof meta.settings> {
  static readonly id = meta.id;
  static readonly pluginName = meta.pluginName;
  static readonly description = meta.description;
  static readonly defaultEnabled = meta.defaultEnabled;
  static readonly settings = meta.settings;

  start() {
    const excludeGuests = this.config.excludeGuests === true;

    this.api.patchComponent<AvatarStackProps>('BaseAvatarStack', (Original) => (props) => {
      const { channelId } = props;
      const count = this.api.redux.useReduxState((state) => {
        if (!channelId) return undefined;
        const channel: SlackChannel | undefined = state.channels?.[channelId];
        if (!channel || channel.is_im || channel.is_mpim) return undefined;
        const counts: MembershipCounts | undefined = state.membershipCounts?.[channelId]?.counts;
        return humanCount(counts, excludeGuests);
      });

      if (typeof props.memberCount !== 'number' || count === undefined || count === props.memberCount) {
        return <Original {...props} />;
      }
      return <Original {...props} memberCount={count} />;
    });
  }
}
