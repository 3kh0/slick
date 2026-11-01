import { SlickPlugin } from '$slick';
import { showTypingIn, typersIn, typingSentence, type Row, type TypingRecord } from './typers.ts';
import * as meta from './meta.ts';

type ChannelProps = Row & { id?: string };
type SuffixProps = { channelId?: string };
type NameOf = (state: unknown, member: unknown) => string;
type I18nClass = new (namespace: string) => { t: (text: string, values?: Record<string, unknown>) => string };
type Sentence = (names: string[]) => string;

const AVATAR_SIZE = 16;
const MAX_AVATARS = 3;

const named = (name: string) => (exp: any) => typeof exp === 'function' && (exp.displayName || exp.name) === name;
const isSidebarChannel = (component: unknown) =>
  typeof component === 'function' && Function.prototype.toString.call(component).includes('getSidebarChannelUiInfo');

export default class ChannelListTyping extends SlickPlugin<typeof meta.settings> {
  static readonly requiredAPIs = ['redux', 'elements'] as const;
  static readonly id = meta.id;
  static readonly pluginName = meta.pluginName;
  static readonly description = meta.description;
  static readonly category = meta.category;
  static readonly defaultEnabled = meta.defaultEnabled;
  static readonly settings = meta.settings;

  private readonly RowContext = React.createContext<Row | null>(null);
  private readonly nameOf = new this.api.Store<NameOf | undefined>(undefined);
  private readonly sentence = new this.api.Store<Sentence | undefined>(undefined);

  start() {
    const { Avatar, Tooltip } = this.api.elements;
    const display = this.config.display;
    const includeCurrent = this.config.includeCurrentChannel !== false;
    const includeMuted = this.config.includeMutedChannels === true;
    const includeThreads = this.config.includeThreads !== false;

    void this.api.waitForExport<NameOf>(named('getPrefCompliantMemberName')).then(this.nameOf.set);
    void this.api.waitForExport<I18nClass>(named('I18n')).then((I18n) => {
      const typing = new I18n('notification_bar');
      const today = new I18n('today');
      this.sentence.set((names) => typingSentence(names, typing.t.bind(typing), today.t.bind(today)));
    });

    this.api.setStyle(`
      .slick-channel-typing {
        display: flex;
        flex: 0 0 auto;
        align-items: center;
        gap: 4px;
        margin-left: auto;
        padding-left: 6px;
      }
      .slick-channel-typing + .p-channel_sidebar__channel_suffix {
        margin-left: 6px;
      }
      .slick-channel-typing__avatars {
        display: flex;
        gap: 2px;
      }
      .slick-channel-typing__avatar {
        width: ${AVATAR_SIZE}px;
        height: ${AVATAR_SIZE}px;
        line-height: 0;
      }
      .slick-channel-typing__dots {
        display: flex;
        gap: 2px;
      }
      .slick-channel-typing__dots i {
        width: 4px;
        height: 4px;
        border-radius: 50%;
        background: currentColor;
        animation: slick-channel-typing 1.2s ease-in-out infinite;
      }
      .slick-channel-typing__dots i:nth-child(2) { animation-delay: 0.15s; }
      .slick-channel-typing__dots i:nth-child(3) { animation-delay: 0.3s; }
      @keyframes slick-channel-typing {
        0%, 60%, 100% { opacity: 0.35; }
        30% { opacity: 1; }
      }
      @media (prefers-reduced-motion: reduce) {
        .slick-channel-typing__dots i { animation: none; opacity: 0.7; }
      }
    `);

    this.api.patchComponent<ChannelProps>(
      { displayName: 'Channel', filter: isSidebarChannel },
      (Original) => (props) => {
        const { isMuted, isSelected, isTyping } = props;
        const value = React.useMemo(() => ({ isMuted, isSelected, isTyping }), [isMuted, isSelected, isTyping]);
        return (
          <this.RowContext.Provider value={value}>
            <Original {...props} />
          </this.RowContext.Provider>
        );
      },
    );

    const Typing = ({ channelId }: { channelId: string }) => {
      const nameOf = this.nameOf.use();
      const sentence = this.sentence.use();
      // a string, so it's equal when nothing changed
      const ids = this.api.redux.useReduxState((state) =>
        typersIn(Object.values<TypingRecord>(state.typing ?? {}), channelId, includeThreads).join(),
      );
      const names = this.api.redux.useReduxState((state) =>
        ids && nameOf ? JSON.stringify(ids.split(',').map((id) => nameOf(state, state.members?.[id]))) : '',
      );
      if (!ids) return null;
      const typers = ids.split(',');
      const tip = sentence && names ? sentence(JSON.parse(names)) : '';
      const indicator = (
        <span className="slick-channel-typing" aria-label={tip || undefined}>
          {display !== 'dots' && (
            <span className="slick-channel-typing__avatars">
              {typers.slice(0, MAX_AVATARS).map((id) => (
                <span key={id} className="slick-channel-typing__avatar">
                  <Avatar userId={id} size={AVATAR_SIZE} isInteractive={false} showCard={false} ariaHidden="true" />
                </span>
              ))}
            </span>
          )}
          {display !== 'avatars' && (
            <span className="slick-channel-typing__dots" aria-hidden="true">
              <i />
              <i />
              <i />
            </span>
          )}
        </span>
      );
      return tip ? <Tooltip tip={tip}>{indicator}</Tooltip> : indicator;
    };

    this.api.patchComponent<SuffixProps>('BaseChannelSuffix', (Original) => (props) => {
      const row = React.useContext(this.RowContext);
      const shown = !!props.channelId && showTypingIn(row, includeCurrent, includeMuted);
      return (
        <>
          {shown && <Typing channelId={props.channelId!} />}
          <Original {...props} />
        </>
      );
    });
  }
}
