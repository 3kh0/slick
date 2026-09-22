// Show who reacted, inside each reaction pill. The ids arrive as
// Reaction's props.users, but the pill is rendered by ReactionAnimation, so a
// context carries them across.

import { SlickPlugin } from '$slick';
import * as meta from './meta.ts';

type ReactionProps = { users?: string[] };

/** Stable identity, so context consumers do not re-render for an empty list. */
const NO_REACTORS: string[] = [];

export default class WhoReacted extends SlickPlugin<typeof meta.settings> {
  static readonly id = meta.id;
  static readonly pluginName = meta.pluginName;
  static readonly description = meta.description;
  static readonly defaultEnabled = meta.defaultEnabled;
  static readonly settings = meta.settings;

  private readonly ReactorsContext = React.createContext<string[]>(NO_REACTORS);

  private get maxAvatars(): number {
    const count = Math.trunc(Number(this.config.maxAvatars));
    return Number.isFinite(count) && count > 0 ? Math.min(count, 20) : 8;
  }

  private readonly Avatar = ({ userId }: { userId: string }) => {
    const profile = this.api.members.useMember(userId)?.profile;
    // A member with no avatar_hash yet gets a URL that 404s.
    const [broken, setBroken] = React.useState(false);
    const url = profile?.image_24 ?? profile?.image_48;
    if (!url || broken) return null;
    return <img className="slick-wr__av" src={url} alt="" onError={() => setBroken(true)} />;
  };

  private readonly Reactors = () => {
    const users = React.useContext(this.ReactorsContext);
    if (!users.length) return null;

    const shown = users.slice(0, this.maxAvatars);
    const rest = users.length - shown.length;
    return (
      <span className="slick-wr">
        {shown.map((userId) => (
          <this.Avatar key={userId} userId={userId} />
        ))}
        {rest > 0 && <span className="slick-wr__more">+{rest}</span>}
      </span>
    );
  };

  start() {
    this.api.setStyle(`
      .slick-wr {
        display: inline-flex;
        align-items: center;
        margin-left: 4px;
        vertical-align: middle;
        pointer-events: none;
      }
      .slick-wr__av {
        display: block;
        width: 16px;
        height: 16px;
        margin-left: -5px;
        border-radius: 50%;
        object-fit: cover;
        /* Matched to the pill, so overlapping avatars stay separated. */
        border: 1px solid var(--dt_color-surf-pry);
        background-color: var(--dt_color-surf-pry);
      }
      .slick-wr__av:first-child {
        margin-left: 0;
      }
      .slick-wr__more {
        margin-left: 3px;
        font-size: 11px;
        font-weight: 700;
        line-height: 1;
      }
    `);

    this.api.patchComponent<ReactionProps>('Reaction', (Original) => (props) => (
      <this.ReactorsContext.Provider value={props.users ?? NO_REACTORS}>
        <Original {...props} />
      </this.ReactorsContext.Provider>
    ));

    // Rendered after the animation, so the avatars land inside the pill.
    this.api.patchComponent('ReactionAnimation', (Original) => (props) => (
      <>
        <Original {...props} />
        <this.Reactors />
      </>
    ));
  }
}
