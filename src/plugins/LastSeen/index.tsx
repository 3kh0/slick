// Show when someone was last seen, from what this client can observe.
//
// Slack exposes no last-seen API, so there are two sources, each behind its
// own setting: RTM traffic that implies someone was at their keyboard, and a
// `search.messages` lookup for their most recent visible message.
//
// v1 kept its observations in `localStorage` with no bound, wrote on every
// event, and scraped the profile pane out of the DOM. v2 keeps a capped map
// flushed on a timer, and renders inside Slack's own presence component.
//
// Adapted from Taut's LastSeen (MIT, github.com/jeremy46231/taut).

import { SlickPlugin } from '$slick';
import { ACTIVITY, ago, prune, when } from './observe.ts';
import * as meta from './meta.ts';

type PresenceProps = { showText?: boolean; isActive?: boolean; isSelf?: boolean; className?: string };
type ProfileProps = { member?: { id?: string } };
type HoverCardProps = { memberId?: string };
type SearchResponse = { messages?: { matches?: { ts?: string }[] } };

/** One entry per person this client has ever seen; it has to be capped. */
const MAX_SEEN = 2000;
const FLUSH_MS = 15_000;
const STORAGE_KEY = 'observed';

export default class LastSeen extends SlickPlugin<typeof meta.settings> {
  static readonly id = meta.id;
  static readonly pluginName = meta.pluginName;
  static readonly description = meta.description;
  static readonly defaultEnabled = meta.defaultEnabled;
  static readonly settings = meta.settings;
  // Both display toggles only change what is drawn.
  static readonly liveSettings = ['showLastMessage', 'showObservedPresence'];

  /** userId -> when we last saw them do something, in ms. */
  private seen = new Map<string, number>();
  private dirty = false;
  private flushTimer: ReturnType<typeof setInterval> | null = null;

  private messages = this.api.Cache<number | null>('last_message', this.ttlMs);

  /** Which profile surface a presence indicator is being rendered inside. */
  private readonly Surface = React.createContext<{ userId?: string; card?: boolean } | undefined>(undefined);

  private get ttlMs(): number {
    const hours = Number(this.config.cacheTtlHours);
    return (Number.isFinite(hours) && hours > 0 ? hours : 168) * 60 * 60 * 1000;
  }

  async start() {
    const stored = await this.api.storage.get<Record<string, number>>(STORAGE_KEY, {});
    if (this.api.signal.aborted) return;
    this.seen = prune(new Map(Object.entries(stored)), MAX_SEEN, this.ttlMs);

    if (this.config.showObservedPresence !== false) {
      for (const [type, who] of Object.entries(ACTIVITY)) {
        this.api.rtm.on(type, (event) => this.sighting(who(event), when(event)));
      }
      // `user_typing` alone fires several times a second across a workspace,
      // so the map is written to disk on a timer rather than per event.
      this.flushTimer = setInterval(() => this.flush(), FLUSH_MS);
    }

    this.api.setStyle(`
      .slick-last-seen__card {
        display: block;
        margin-top: 2px;
        font-size: 13px;
        color: rgba(var(--sk_foreground_high_solid, 134, 134, 134), 1);
      }
    `);

    this.patchSurfaces();
  }

  stop() {
    if (this.flushTimer) clearInterval(this.flushTimer);
    this.flushTimer = null;
    this.flush();
  }

  private flush() {
    if (!this.dirty) return;
    this.dirty = false;
    this.seen = prune(this.seen, MAX_SEEN, this.ttlMs);
    void this.api.storage.set(STORAGE_KEY, Object.fromEntries(this.seen));
  }

  private sighting(who: string | string[] | undefined, at: number) {
    if (!who || !(at > 0)) return;
    for (const id of typeof who === 'string' ? [who] : who) {
      const known = this.seen.get(id);
      if (known === undefined || known < at) {
        this.seen.set(id, at);
        this.dirty = true;
      }
    }
  }

  private patchSurfaces() {
    // The profile pane and the hover card each know whose profile they are;
    // the presence indicator inside them does not.
    this.api.patchComponent<ProfileProps>('RimetoProfilePresence', (Original) => (props) => (
      <this.Surface.Provider value={{ userId: props.member?.id }}>
        <Original {...props} />
      </this.Surface.Provider>
    ));

    this.api.patchComponent<HoverCardProps>('MemberProfileHoverCard', (Original) => (props) => (
      <this.Surface.Provider value={{ userId: props.memberId, card: true }}>
        <Original {...props} />
      </this.Surface.Provider>
    ));

    this.api.patchComponent<PresenceProps>('Presence', (Original) => (props) => {
      const surface = React.useContext(this.Surface);
      // Only where Slack already draws words, for someone else, who is away.
      const id = props.showText && !props.isActive && !props.isSelf && !surface?.card ? surface?.userId : undefined;
      const seen = this.useLastSeen(id);
      if (!seen) return <Original {...props} />;

      return (
        <>
          <Original {...props} showText={false} />
          <span className="padding_left_50 slick-last-seen" aria-hidden="true">{`Last seen ${ago(seen)}`}</span>
        </>
      );
    });

    // The hover card shows a dot with no words, so it gets a line of its own.
    this.api.patchComponent<ProfileProps>('LocalTime', (Original) => (props) => {
      const surface = React.useContext(this.Surface);
      const id = surface?.card ? props.member?.id : undefined;
      return (
        <>
          <Original {...props} />
          {id ? <this.CardLine userId={id} /> : null}
        </>
      );
    });
  }

  private readonly CardLine = ({ userId }: { userId: string }) => {
    const seen = this.useLastSeen(userId);
    const presence = this.api.redux.useReduxState((state) => state.presence?.[userId]?.presence);
    if (!seen || presence === 'active') return null;
    return (
      <span className="slick-last-seen__card" title={new Date(seen).toLocaleString()}>
        {`Last seen ${ago(seen)}`}
      </span>
    );
  };

  private useLastSeen(userId: string | undefined): number {
    const [seen, setSeen] = React.useState(0);

    React.useEffect(() => {
      if (!userId) {
        setSeen(0);
        return;
      }
      if (this.config.trackWatchlist === true) this.watch(userId);

      let live = true;
      const settle = (fromMessage: number | null) => {
        if (!live) return;
        const observed = this.config.showObservedPresence === false ? 0 : (this.seen.get(userId) ?? 0);
        setSeen(Math.max(observed, fromMessage ?? 0));
      };

      settle(null);
      // Never on the render path: this is a rate-limited API.
      if (this.config.showLastMessage !== false)
        this.lastMessageOf(userId)
          .then(settle)
          .catch(() => {});

      return () => {
        live = false;
      };
    }, [userId]);

    return seen;
  }

  /** Off by default: this sends a presence subscription for everyone whose
   *  profile is opened, which is real extra websocket traffic. */
  private watch(userId: string) {
    void this.api.redux
      .dispatchThunk('subscribeToPresence', { memberIds: [userId], reason: 'slick-last-seen' })
      .catch(() => {});
  }

  private lastMessageOf(userId: string): Promise<number | null> {
    return this.messages.get(userId, async () => {
      const response = await this.api.userAPI<SearchResponse>(
        'search.messages',
        { query: `from:<@${userId}>`, sort: 'timestamp', sort_dir: 'desc', count: '1' },
        { rateLimitRetries: 2, signal: this.api.signal },
      );
      const ts = response.messages?.matches?.[0]?.ts;
      const at = ts ? Math.round(Number.parseFloat(ts) * 1000) : 0;
      return at || null;
    });
  }
}
