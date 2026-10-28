import { SlickPlugin, type SlackChannel } from '$slick';
import { channelPeople, estimateOnline, onlineCount, tally, type Query } from './members.ts';
import * as meta from './meta.ts';

type AvatarStackProps = { channelId?: string };
type Members = { count: number; ids: string[] };
type Estimate = { count: number; online: number; sampled: number; at: number };
type Subscription = Record<string, number> | undefined;

// Slack's server ignores a presence subscription of more than about 1,000 people, Slack's own included.
const SUBSCRIPTION_CAP = 950;
const LIVE_LIMIT = 500;
const SAMPLE = 2000;
const MIN_WAIT_MS = 2000;
const MAX_WAIT_MS = 6000;
const ESTIMATE_TTL_MS = 10 * 60 * 1000;

const isFlannelQuery = (exp: any) =>
  typeof exp === 'function' &&
  exp.name === 'query' &&
  Function.prototype.toString.call(exp).includes('Unsupported flannel method');
const isSubscriptionGetter = (exp: any) => typeof exp === 'function' && exp.name === 'getPresenceSubscriptionByTeamId';
const compact = new Intl.NumberFormat(undefined, { notation: 'compact', maximumFractionDigits: 1 });
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export default class OnlineCount extends SlickPlugin<typeof meta.settings> {
  static readonly requiredAPIs = ['redux', 'elements'] as const;
  static readonly id = meta.id;
  static readonly pluginName = meta.pluginName;
  static readonly description = meta.description;
  static readonly defaultEnabled = meta.defaultEnabled;
  static readonly settings = meta.settings;

  private readonly active = new this.api.Store(false);
  private readonly query = new this.api.Store<Query | undefined>(undefined);
  private subscription?: (teamId: string) => Subscription;
  private readonly members = new Map<string, Members>();
  private readonly estimates = new Map<string, Estimate>();

  private teamId(): string | undefined {
    return this.api.redux.getRawState()?.selfTeamIds?.teamId;
  }

  private room(teamId: string) {
    return SUBSCRIPTION_CAP - Object.keys(this.subscription?.(teamId) ?? {}).length;
  }

  private subscribe(ids: readonly string[]) {
    for (const id of ids) void this.api.redux.dispatchThunk('addMemberToPresenceSubscription', id).catch(() => {});
    return () => {
      for (const id of ids)
        void this.api.redux.dispatchThunk('removeMemberFromPresenceSubscription', id).catch(() => {});
    };
  }

  private async measure(ids: readonly string[], signal: AbortSignal) {
    const unsubscribe = this.subscribe(ids);
    try {
      await sleep(MIN_WAIT_MS);
      for (let waited = MIN_WAIT_MS; waited < MAX_WAIT_MS && !signal.aborted; waited += 250) {
        if (onlineCount(ids, this.api.redux.getRawState()?.presence) !== undefined) break;
        await sleep(250);
      }
      return tally(ids, this.api.redux.getRawState()?.presence);
    } finally {
      unsubscribe();
    }
  }

  private async estimate(query: Query, channelId: string, count: number, signal: AbortSignal) {
    const teamId = this.teamId();
    if (!teamId) return undefined;
    const ids = await channelPeople(query, teamId, channelId, SAMPLE);
    let sampled = 0;
    let online = 0;
    for (let start = 0; start < ids.length && !signal.aborted;) {
      const size = Math.min(LIVE_LIMIT, this.room(teamId));
      if (size < 50) break;
      const batch = await this.measure(ids.slice(start, start + size), signal);
      sampled += batch.known;
      online += batch.online;
      start += size;
    }
    if (signal.aborted || !sampled) return undefined;
    const estimate = { count, online: estimateOnline(count, online, sampled)!, sampled, at: Date.now() };
    this.estimates.set(channelId, estimate);
    return estimate;
  }

  private cachedEstimate(channelId: string, count: number) {
    const cached = this.estimates.get(channelId);
    return cached?.count === count && Date.now() - cached.at < ESTIMATE_TTL_MS ? cached : undefined;
  }

  private useEstimate(channelId: string, count: number) {
    const query = this.query.use();
    const [estimate, setEstimate] = React.useState(() => this.cachedEstimate(channelId, count));
    React.useEffect(() => {
      const cached = this.cachedEstimate(channelId, count);
      setEstimate(cached);
      if (cached || !query) return;
      const controller = new AbortController();
      this.estimate(query, channelId, count, controller.signal).then(
        (result) => !controller.signal.aborted && setEstimate(result),
        (error) => this.log('could not estimate', error),
      );
      return () => controller.abort();
    }, [query, channelId, count]);
    return estimate;
  }

  private cachedPeople(channelId: string, count: number) {
    const cached = this.members.get(channelId);
    return cached?.count === count ? cached.ids : undefined;
  }

  private usePeople(channelId: string, count: number) {
    const query = this.query.use();
    const [ids, setIds] = React.useState(() => this.cachedPeople(channelId, count));
    React.useEffect(() => {
      const cached = this.cachedPeople(channelId, count);
      setIds(cached);
      const teamId = this.teamId();
      if (cached || !query || !teamId) return;
      let live = true;
      channelPeople(query, teamId, channelId, count).then(
        (people) => {
          this.members.set(channelId, { count, ids: people });
          if (live) setIds(people);
        },
        (error) => this.log('could not list members', error),
      );
      return () => {
        live = false;
      };
    }, [query, channelId, count]);
    React.useEffect(() => {
      const teamId = this.teamId();
      if (!ids || !teamId || ids.length > this.room(teamId)) return;
      return this.subscribe(ids);
    }, [ids]);
    return ids;
  }

  start() {
    const { Tooltip } = this.api.elements;
    const estimateBig = this.config.estimate !== false;
    this.active.set(true);
    this.api.signal.addEventListener('abort', () => this.active.set(false), { once: true });
    void this.api.waitForExport<Query>(isFlannelQuery).then(this.query.set);
    void this.api.waitForExport<(teamId: string) => Subscription>(isSubscriptionGetter).then((getter) => {
      this.subscription = getter;
    });

    this.api.setStyle(`
      .p-autoclog__hook:has(> .slick-online-count) {
        display: flex;
        align-items: center;
        gap: 6px;
      }
      .slick-online-count {
        display: inline-flex;
        align-items: center;
        gap: 5px;
        padding-right: 4px;
        color: var(--dt_color-content-sec);
        font-size: 13px;
        font-weight: 700;
        font-variant-numeric: tabular-nums;
        white-space: nowrap;
      }
      .slick-online-count::before {
        content: '';
        width: 8px;
        height: 8px;
        border-radius: 50%;
        background: var(--dt_color-theme-base-inv-hgl-2);
      }
    `);

    const Count = ({ text, tip }: { text: string; tip: string }) => (
      <Tooltip tip={tip}>
        <span className="slick-online-count">{text}</span>
      </Tooltip>
    );

    const Exact = ({ channelId, count }: { channelId: string; count: number }) => {
      const ids = this.usePeople(channelId, count);
      const online = this.api.redux.useReduxState((state) => (ids ? onlineCount(ids, state.presence) : undefined));
      if (online === undefined || !ids) return null;
      const away = ids.length - online;
      return (
        <Count
          text={online.toLocaleString()}
          tip={`${online.toLocaleString()} online, ${away.toLocaleString()} away`}
        />
      );
    };

    const Estimated = ({ channelId, count }: { channelId: string; count: number }) => {
      const estimate = this.useEstimate(channelId, count);
      if (!estimate) return null;
      return (
        <Count
          text={`~${compact.format(estimate.online)}`}
          tip={`About ${estimate.online.toLocaleString()} online, estimated from ${estimate.sampled.toLocaleString()} of ${count.toLocaleString()} members`}
        />
      );
    };

    this.api.patchComponent<AvatarStackProps>('BaseAvatarStack', (Original) => (props) => {
      const active = this.active.use();
      const { channelId } = props;
      const count = this.api.redux.useReduxState((state) => {
        if (!active || !channelId) return undefined;
        const channel: SlackChannel | undefined = state.channels?.[channelId];
        if (!channel || channel.is_im || channel.is_mpim) return undefined;
        const people = state.membershipCounts?.[channelId]?.counts?.member_count;
        return typeof people === 'number' ? people : undefined;
      });
      const Online = count !== undefined && count > LIVE_LIMIT ? (estimateBig ? Estimated : null) : Exact;
      return (
        <>
          <Original {...props} />
          {channelId && count !== undefined && Online && <Online channelId={channelId} count={count} />}
        </>
      );
    });
  }
}
