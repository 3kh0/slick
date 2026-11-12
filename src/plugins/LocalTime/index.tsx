// Profiles get their own line rather than Slack's LocalTime, which Slack hides while someone is OOO.

import { SlickPlugin } from '$slick';
import { localTime, otherLocalTime } from './format.ts';
import * as meta from './meta.ts';

type Message = { user?: string; bot_id?: string };
type BroadcastPreambleProps = { msg?: Message; children?: React.ReactNode };
type ThreadHeaderProps = {
  msg?: Message;
  adjacent?: boolean;
  visible?: boolean;
  omitTimestamp?: boolean;
  omitLinebreak?: boolean;
};
type ProfileProps = { member?: { id?: string } };
type HoverCardProps = { memberId?: string };
type Surface = { userId?: string; hoverCard?: boolean };

const USER_ID = /^[UW][A-Z0-9]+$/;
const systemZone = Intl.DateTimeFormat().resolvedOptions().timeZone;

const isPerson = (msg: Message | undefined): msg is Message & { user: string } =>
  !!msg?.user && USER_ID.test(msg.user) && msg.user !== 'USLACKBOT' && !msg.bot_id;

const isHeaderChild = (child: React.ReactNode, prop: string): boolean => {
  const props = React.isValidElement(child) ? child.props : null;
  if (typeof props !== 'object' || props === null) return false;
  return prop in props && (props as { visible?: boolean }).visible !== false;
};

const isTimestamp = (child: React.ReactNode) => isHeaderChild(child, 'clickable');
const isSender = (child: React.ReactNode) => isHeaderChild(child, 'isInteractive');

// One timer for every mounted clock, so a screen of messages doesn't run a timer each.
const listeners = new Set<() => void>();
let ticker: ReturnType<typeof setInterval> | undefined;
const subscribe = (listener: () => void) => {
  listeners.add(listener);
  ticker ??= setInterval(() => listeners.forEach((notify) => notify()), 60_000);
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0 && ticker) {
      clearInterval(ticker);
      ticker = undefined;
    }
  };
};

export default class LocalTime extends SlickPlugin<typeof meta.settings> {
  static readonly requiredAPIs = ['members', 'elements'] as const;
  static readonly id = meta.id;
  static readonly pluginName = meta.pluginName;
  static readonly description = meta.description;
  static readonly defaultEnabled = meta.defaultEnabled;
  static readonly settings = meta.settings;

  private readonly Surfaces = React.createContext<Surface | undefined>(undefined);

  private readonly Clock = ({ userId, className }: { userId: string; className: string }) => {
    const member = this.api.members.useMember(userId);
    const viewer = this.api.members.useMember(this.api.members.getCurrentMemberId() ?? '');
    const now = React.useSyncExternalStore(
      subscribe,
      () => Math.floor(Date.now() / 60_000),
      () => 0,
    );
    const text = otherLocalTime(member?.tz, viewer?.tz ?? systemZone, this.config.use12Hour !== false, now * 60_000);
    if (!text) return null;
    return (
      <span className={className} data-stringify-ignore="">
        {text}
      </span>
    );
  };

  start() {
    this.api.setStyle(`
      .slick-local-time {
        margin-left: 6px;
        align-self: center;
        font-size: 12px;
        font-weight: 400;
        color: rgba(var(--sk_foreground_max_solid, 97, 96, 97), 1);
        white-space: nowrap;
        cursor: default;
        user-select: none;
      }
      .slick-local-time--bulleted {
        margin-left: 0;
      }
      .slick-local-time--bulleted::before {
        content: '\\2022';
        margin: 0 4px;
      }
      .slick-local-time__card {
        display: block;
        margin-top: 2px;
        font-size: 13px;
        color: rgba(var(--sk_foreground_high_solid, 134, 134, 134), 1);
      }
      .slick-local-time__card--hover {
        margin-top: 0;
        padding: 0 16px 12px;
      }
      .slick-local-time__card--profile {
        display: flex;
        align-items: center;
        gap: 8px;
        margin-top: 8px;
        font-size: inherit;
        color: inherit;
      }
    `);

    if (this.config.showInMessages !== false) this.patchMessages();
    if (this.config.showOnProfiles !== false) this.patchProfiles();
  }

  private patchMessages() {
    this.api.patchComponent<BroadcastPreambleProps>('BaseBroadcastPreamble', (Original) => (props) => {
      if (!isPerson(props.msg)) return <Original {...props} />;

      const children = React.Children.toArray(props.children);
      const timestamp = children.findIndex(isTimestamp);
      const anchor = timestamp === -1 ? children.findIndex(isSender) : timestamp;
      if (anchor === -1) return <Original {...props} />;

      children.splice(
        anchor + 1,
        0,
        <this.Clock
          key="slick-local-time"
          userId={props.msg.user}
          className={`slick-local-time${timestamp !== -1 ? ' slick-local-time--bulleted' : ''}`}
        />,
      );
      return <Original {...props}>{children}</Original>;
    });

    this.api.patchComponent<ThreadHeaderProps>('ThreadSenderAndTimestampGeneric', (Original) => (props) => {
      if (props.adjacent || props.visible === false || !isPerson(props.msg)) return <Original {...props} />;

      return (
        <>
          <Original {...props} omitLinebreak />
          <this.Clock
            userId={props.msg.user}
            className={`slick-local-time${props.omitTimestamp ? '' : ' slick-local-time--bulleted'}`}
          />
          {props.omitLinebreak ? null : <br />}
        </>
      );
    });
  }

  private patchProfiles() {
    this.api.patchComponent<ProfileProps>('LocalTimeRow', (Original) => (props) => {
      const userId = props.member?.id;
      return (
        <this.Surfaces.Provider value={{ userId }}>
          {userId ? <this.CardLine userId={userId} /> : null}
          <Original {...props} />
        </this.Surfaces.Provider>
      );
    });

    this.api.patchComponent<HoverCardProps>('MemberProfileHoverCard', (Original) => (props) => {
      const userId = props.memberId;
      return (
        <this.Surfaces.Provider value={{ userId, hoverCard: true }}>
          <Original {...props} />
        </this.Surfaces.Provider>
      );
    });

    this.api.patchComponent<HoverCardProps>('MemberProfileBaseEntity', (Original) => (props) => {
      const surface = React.useContext(this.Surfaces);
      return (
        <>
          <Original {...props} />
          {surface?.hoverCard && surface.userId ? <this.CardLine userId={surface.userId} hoverCard /> : null}
        </>
      );
    });

    // Slack's own line is hidden while OOO, and ours replaces it everywhere else on these surfaces.
    this.api.patchComponent<ProfileProps>('LocalTime', (Original) => (props) => {
      const surface = React.useContext(this.Surfaces);
      if (surface?.userId) return null;
      return <Original {...props} />;
    });
  }

  private readonly CardLine = ({ userId, hoverCard }: { userId: string; hoverCard?: boolean }) => {
    const member = this.api.members.useMember(userId);
    const now = React.useSyncExternalStore(
      subscribe,
      () => Math.floor(Date.now() / 60_000),
      () => 0,
    );
    const text = localTime(member?.tz, this.config.use12Hour !== false, now * 60_000);
    if (!text) return null;
    return (
      <span className={`slick-local-time__card slick-local-time__card--${hoverCard ? 'hover' : 'profile'}`}>
        {hoverCard ? null : <this.api.elements.SvgIcon name="clock" size={20} />}
        <span>{`${text} local time`}</span>
      </span>
    );
  };
}
