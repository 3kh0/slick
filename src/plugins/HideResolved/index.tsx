import { SlickPlugin, type SlackChannel } from '$slick';
import {
  channelMatcher,
  filterHistory,
  hides,
  linkedTs,
  parseList,
  type Data,
  type History,
  type Rules,
} from './tickets.ts';
import * as meta from './meta.ts';

type Filtered = {
  messages: unknown;
  reactions: unknown;
  linked: string;
  version: number;
  history: History;
  hidden: number;
};

export default class HideResolved extends SlickPlugin<typeof meta.settings> {
  static readonly id = meta.id;
  static readonly pluginName = meta.pluginName;
  static readonly description = meta.description;
  static readonly category = meta.category;
  static readonly defaultEnabled = meta.defaultEnabled;
  static readonly settings = meta.settings;
  static readonly requiredAPIs = ['redux', 'elements'] as const;
  static readonly liveSettings = ['channels', 'hide', 'openEmoji', 'resolvedEmoji'];

  private rules: Rules = { open: new Set(), resolved: new Set() };
  private isHelpChannel: (name: string | undefined) => boolean = () => false;
  private revealed = new Set<string>();
  private version = 0;
  private filtered = new WeakMap<object, Filtered>();
  private hiddenBy = new WeakMap<object, number>();

  start() {
    this.load();
    this.api.redux.patchState((state) => {
      if (!state.channelHistory) return state;
      return {
        ...state,
        channelHistory: this.api.redux.mapEntries<History>(state.channelHistory, (key, history) =>
          history && !key.includes('-') ? this.filter(state, key, history).history : history,
        ),
      };
    });
    this.patchHeader();
  }

  onSettingsChange() {
    this.load();
    this.refresh();
  }

  private load() {
    this.rules = {
      open: new Set(parseList(this.config.openEmoji)),
      resolved: new Set(parseList(this.config.resolvedEmoji)),
    };
    this.isHelpChannel = channelMatcher(this.config.channels);
  }

  private refresh() {
    this.version++;
    this.api.redux.refresh();
  }

  private applies(state: Data, channelId: string): boolean {
    return !this.revealed.has(channelId) && this.isHelpChannel((state.channels?.[channelId] as SlackChannel)?.name);
  }

  private filter(state: Data, channelId: string, history: History): { history: History; hidden: number } {
    if (!this.applies(state, channelId)) return { history, hidden: 0 };
    const messages = state.messages?.[channelId];
    const reactions = state.reactions;
    const linked = linkedTs(state.viewUiState, channelId);
    const cached = this.filtered.get(history);
    if (
      cached &&
      cached.messages === messages &&
      cached.reactions === reactions &&
      cached.linked === linked &&
      cached.version === this.version
    )
      return cached;
    const notOpen = this.config.hide === 'notOpen';
    const keep = new Set(linked.split(','));
    const result = filterHistory(history, (ts) => {
      if (keep.has(ts)) return false;
      return hides(messages?.[ts], messages, reactions, channelId, this.rules, notOpen);
    });
    const entry = { messages, reactions, linked, version: this.version, ...result };
    this.filtered.set(history, entry);
    this.hiddenBy.set(entry.history, entry.hidden);
    return entry;
  }

  private hiddenCount(state: Data, channelId: string): number {
    const history = state.channelHistory?.[channelId];
    return (history && this.hiddenBy.get(history)) || 0;
  }

  private toggle(channelId: string) {
    if (this.revealed.has(channelId)) this.revealed.delete(channelId);
    else this.revealed.add(channelId);
    this.refresh();
  }

  private patchHeader() {
    const { SvgIcon, Tooltip } = this.api.elements;
    this.api.patchComponent<{ channel?: SlackChannel | string }>('ViewHeaderSearch', (Original) => (props) => {
      this.api.redux.usePatchVersion();
      const channelId = typeof props.channel === 'string' ? props.channel : props.channel?.id;
      const info = this.api.redux.useReduxState((state) => {
        if (!channelId || !this.isHelpChannel(state.channels?.[channelId]?.name)) return undefined;
        return this.revealed.has(channelId) ? -1 : this.hiddenCount(state, channelId);
      });
      if (info === undefined || !channelId) return <Original {...props} />;
      const revealed = info < 0;
      const what = this.config.hide === 'notOpen' ? 'hidden' : 'resolved';
      const label = revealed ? `Hide ${what} messages` : info ? `Show ${info} ${what}` : 'Showing open tickets';
      return (
        <>
          <Tooltip tip={label}>
            <button
              type="button"
              className={`c-button-unstyled slick-hide-resolved${revealed ? ' slick-hide-resolved--revealed' : ''}`}
              aria-label={label}
              aria-pressed={!revealed}
              data-qa="slick-hide-resolved"
              onClick={() => this.toggle(channelId)}
            >
              <SvgIcon name={revealed ? 'check-circle' : 'check-circle-filled'} size={18} />
              {!revealed && info > 0 && <span>{info}</span>}
            </button>
          </Tooltip>
          <Original {...props} />
        </>
      );
    });
    this.api.setStyle(`
      .slick-hide-resolved {
        display: inline-flex;
        align-items: center;
        gap: 4px;
        height: 28px;
        min-width: 28px;
        padding: 0 6px;
        border-radius: 6px;
        color: var(--dt_color-content-pry);
        font-size: 13px;
        font-weight: 600;
        justify-content: center;
      }
      .slick-hide-resolved:hover { background: var(--dt_color-surf-ter); }
      .slick-hide-resolved--revealed { color: var(--dt_color-content-sec); }
    `);
  }
}
