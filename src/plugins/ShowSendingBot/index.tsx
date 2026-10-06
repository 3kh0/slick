import { SlickPlugin, type SlackActivityItem, type SlackBot, type SlackMessage } from '$slick';
import * as meta from './meta.ts';

type AvatarProps = { className?: string; size?: number; userId?: string };
type GutterProps = { light?: React.ReactNode; compact?: React.ReactNode };
type ActivityAvatarProps = {
  activityItem?: SlackActivityItem;
  size?: 'small' | 'large';
  children?: React.ReactNode;
};
type ContextBlock = { type?: string; elements?: { type?: string; text?: unknown }[] };
type MessageAttachmentProps = {
  activeChannelId?: string;
  messageTs?: string;
  attachmentIndex?: number;
  authorId?: string;
  authorLink?: string;
};

const SERVICE_RE = /\/services\/(B[A-Z0-9]+)/;
const MCP_FOOTER_RE = /^\*Sent using\*\s+<@([UW][A-Z0-9]+)>$/;
const drawsSender = (className = '') =>
  ['c-message_kit__avatar', 'c-search_message__avatar', 'c-message_attachment__author_icon'].some((name) =>
    className.split(' ').includes(name),
  );
const badgeSize = (avatar = 36) => (avatar >= 32 ? 20 : 14);
const isCompactGutter = (slot: React.ReactNode) =>
  React.isValidElement<{ className?: string }>(slot) &&
  (slot.props.className ?? '').includes('p-message_pane_message__compact_timestamp');

function mcpFooterMember(msg?: SlackMessage): string | undefined {
  const blocks = msg?.blocks as ContextBlock[] | undefined;
  const last = Array.isArray(blocks) ? blocks.at(-1) : undefined;
  if (last?.type !== 'context' || last.elements?.length !== 1) return undefined;
  const element = last.elements[0];
  if (element?.type !== 'mrkdwn') return undefined;
  return MCP_FOOTER_RE.exec(String(element.text ?? '').trim())?.[1];
}

function withoutMcpFooter(msg: SlackMessage): SlackMessage {
  const next: SlackMessage = { ...msg, blocks: (msg.blocks as unknown[]).slice(0, -1) };
  if (Array.isArray(msg.blocksProcessed)) next.blocksProcessed = msg.blocksProcessed.slice(0, -1);
  return next;
}

export default class ShowSendingBot extends SlickPlugin<typeof meta.settings> {
  static readonly requiredAPIs = ['elements', 'members', 'messages', 'redux'] as const;
  static readonly id = meta.id;
  static readonly pluginName = meta.pluginName;
  static readonly description = meta.description;
  static readonly defaultEnabled = meta.defaultEnabled;
  static readonly settings = meta.settings;

  private apps = this.api.Cache<string | null>('message_apps', 30 * 24 * 60 * 60 * 1000, 5000);
  private pendingApps = new Set<string>();
  private failedApps = new Set<string>();
  private appTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly SenderContext = React.createContext<SlackMessage | undefined>(undefined);
  private readonly ThreadSenderContext = React.createContext<SlackMessage | undefined>(undefined);

  private appIdOf(msg: SlackMessage | undefined): string | undefined {
    if (typeof msg?.channel !== 'string' || !msg.ts) return undefined;
    const key = `${msg.channel}:${msg.ts}`;
    const known = this.apps.peek(key);
    if (known !== undefined) return known ?? undefined;
    if (!this.failedApps.has(key)) this.queueApp(key);
    return undefined;
  }

  private queueApp(key?: string) {
    if (key) this.pendingApps.add(key);
    if (this.appTimer || this.api.signal.aborted) return;
    this.appTimer = setTimeout(() => void this.lookUpApps(), 50);
  }

  private takeApps(): Map<string, string[]> {
    const byChannel = new Map<string, string[]>();
    let taken = 0;
    for (const key of this.pendingApps) {
      if (taken >= 100) break;
      const split = key.indexOf(':');
      const channel = key.slice(0, split);
      let timestamps = byChannel.get(channel);
      if (!timestamps) {
        if (byChannel.size >= 5) continue;
        timestamps = [];
        byChannel.set(channel, timestamps);
      }
      timestamps.push(key.slice(split + 1));
      this.pendingApps.delete(key);
      taken++;
    }
    return byChannel;
  }

  private async lookUpApps() {
    this.appTimer = null;
    const byChannel = this.takeApps();
    if (!byChannel.size) return;
    const keys = [...byChannel].flatMap(([channel, timestamps]) => timestamps.map((ts) => `${channel}:${ts}`));
    try {
      const response = await this.api.userAPI<{ messages?: Record<string, SlackMessage[]> }>(
        'messages.list',
        {
          message_ids: JSON.stringify([...byChannel].map(([channel, timestamps]) => ({ channel, timestamps }))),
        },
        { rateLimitRetries: 2, signal: this.api.signal },
      );
      const foundByKey = new Map<string, SlackMessage>();
      for (const [channel, found] of Object.entries(response.messages ?? {}))
        for (const msg of found) if (msg.ts) foundByKey.set(`${channel}:${msg.ts}`, msg);
      await Promise.all(
        keys.map((key) =>
          this.apps.get(key, async () => {
            const appId = foundByKey.get(key)?.app_id;
            return typeof appId === 'string' ? appId : null;
          }),
        ),
      );
    } catch {
      for (const key of keys) this.failedApps.add(key);
    }
    if (this.api.signal.aborted) return;
    this.api.redux.refresh();
    if (this.pendingApps.size) this.queueApp();
  }

  private useUncreditedBot(msg: SlackMessage | undefined): SlackBot | undefined {
    const { asRawMessage, useMessageBot } = this.api.messages;
    const bot = useMessageBot(msg);
    const rawUser = this.api.redux.useReduxState(() => asRawMessage(msg)?.user);
    const credited = msg?.user;
    const memberBot = this.api.members.useMember(credited ?? '')?.profile?.bot_id;
    if (!bot?.id || !credited || (!bot.name && !bot.icons)) return undefined;
    const reCredited = credited !== rawUser;
    const asPerson = memberBot !== bot.id && bot.user_id !== credited;
    return reCredited || asPerson ? bot : undefined;
  }

  private useAppPoster(msg: SlackMessage | undefined): string | undefined {
    const { asRawMessage, getMessageBotId } = this.api.messages;
    this.api.redux.usePatchVersion();
    const raw = asRawMessage(msg);
    const claimed = getMessageBotId(raw) ? undefined : mcpFooterMember(raw);
    const appId = claimed ? this.appIdOf(raw) : undefined;
    const claimedApp = this.api.members.useMember(claimed ?? '')?.profile?.api_app_id;
    return claimed && appId && claimedApp === appId ? claimed : undefined;
  }

  private useSender(msg: SlackMessage | undefined) {
    const bot = this.useUncreditedBot(msg);
    const memberId = this.useAppPoster(msg);
    if (bot?.id) return { bot };
    return memberId ? { memberId } : undefined;
  }

  private readonly Badge = ({
    bot,
    memberId,
    size,
    corner,
    interactive = true,
  }: {
    bot?: SlackBot;
    memberId?: string;
    size: number;
    corner?: string;
    interactive?: boolean;
  }) => {
    const { Avatar, ProfileHoverTrigger } = this.api.elements;
    const avatar = (
      <Avatar botId={bot?.id} botProfile={bot} userId={memberId} size={size - 2} isInteractive={interactive} />
    );
    return (
      <span
        className={`slick-sending-bot__badge${corner ? ` slick-sending-bot__badge--${corner}` : ''}`}
        style={{ width: size, height: size }}
        data-stringify-ignore="true"
      >
        {interactive ? (
          <ProfileHoverTrigger serviceId={bot?.id} memberId={memberId} botProfile={bot}>
            {avatar}
          </ProfileHoverTrigger>
        ) : (
          avatar
        )}
      </span>
    );
  };

  private readonly Badged = ({
    msg,
    size,
    children,
  }: {
    msg?: SlackMessage;
    size?: number;
    children: React.ReactNode;
  }) => {
    const sender = this.useSender(msg);
    if (!sender) return <>{children}</>;
    return (
      <span className="slick-sending-bot">
        {children}
        <this.Badge {...sender} size={badgeSize(size)} />
      </span>
    );
  };

  private provideMessage(name: string, messageOf: (props: any) => SlackMessage | undefined) {
    this.api.patchComponent(name, (Original) => (props: any) => (
      <this.SenderContext.Provider value={messageOf(props)}>
        <Original {...props} />
      </this.SenderContext.Provider>
    ));
  }

  start() {
    if (this.api.signal.aborted) return;
    this.api.setStyle(`
      .slick-sending-bot { position: relative; display: flex; flex-shrink: 0; align-self: flex-start; }
      .slick-sending-bot__badge {
        position: absolute; right: -3px; bottom: -3px; display: flex; align-items: center;
        justify-content: center; padding: 1px; border-radius: 4px;
        background-color: light-dark(var(--dt_color-base-sec), var(--dt_color-base-ter));
      }
      .slick-sending-bot__badge--bottom-left { left: -3px; right: auto; }
      .c-message_kit__gutter__left { position: relative; }
      .slick-sending-bot__badge--gutter { right: calc(100% - 2px); bottom: auto; left: auto; top: 8px; translate: 0 -50%; }
      .slick-sending-bot__badge--inline,
      .c-message_kit__background--hovered .slick-sending-bot__badge--inline {
        position: static; display: inline-flex; vertical-align: text-bottom; margin-left: 4px; padding: 0; background: transparent;
      }
      .slick-sending-bot__badge .c-base_icon { vertical-align: top; }
      .c-message_kit__background--hovered .slick-sending-bot__badge {
        background-color: rgba(var(--sk_foreground_min_solid, 248, 248, 248), 1);
      }
    `);

    this.provideMessage('ProgressiveDisclosureSuccessCoachmarkWrapper', (props) => props.msg);
    this.provideMessage('MessageAvatar', (props) => props.msg);
    this.provideMessage('SearchResult', (props) => props);
    this.provideMessage('MessageAttachment', (props: MessageAttachmentProps) => {
      const stored =
        props.activeChannelId && props.messageTs
          ? this.api.messages.getRawMessage(props.activeChannelId, props.messageTs)?.attachments?.[
              props.attachmentIndex ?? 0
            ]
          : undefined;
      const botId = SERVICE_RE.exec(stored?.author_link ?? props.authorLink ?? '')?.[1];
      return { user: props.authorId, bot_id: botId, channel: props.activeChannelId, ts: props.messageTs };
    });

    this.api.patchComponent<AvatarProps>('ConnectedBaseAvatar', (Original) => (props) => {
      const msg = React.useContext(this.SenderContext);
      const drawn = msg && drawsSender(props.className) ? { ...msg, user: props.userId } : undefined;
      return (
        <this.Badged msg={drawn} size={props.size}>
          <Original {...props} />
        </this.Badged>
      );
    });

    this.api.patchComponent<ActivityAvatarProps>('ActivityRowContentSenderAvatarLayout', (Original) => (props) => {
      const msg = this.api.messages.useActivityMessage(props.activityItem);
      const sender = this.useSender(msg);
      if (!sender) return <Original {...props} />;
      return (
        <Original {...props}>
          {props.children}
          <this.Badge
            {...sender}
            size={badgeSize(props.size === 'large' ? 36 : 28)}
            corner="bottom-left"
            interactive={false}
          />
        </Original>
      );
    });

    this.api.patchComponent<GutterProps>(
      {
        filter: (exp: any) =>
          exp?.$$typeof === Symbol.for('react.memo') &&
          typeof exp.type === 'function' &&
          String(exp.type).includes('c-message_kit__gutter__left'),
      },
      (Original) => (props) => {
        const msg = React.useContext(this.SenderContext);
        const sender = this.useSender(msg);
        const slot = isCompactGutter(props.compact) ? 'compact' : isCompactGutter(props.light) ? 'light' : null;
        if (!sender || !slot) return <Original {...props} />;
        return (
          <Original
            {...props}
            {...{
              [slot]: (
                <>
                  {props[slot]}
                  <this.Badge {...sender} size={18} corner="gutter" />
                </>
              ),
            }}
          />
        );
      },
    );

    this.api.patchComponent<{ msg?: SlackMessage }>('ThreadSenderAndTimestampGeneric', (Original) => (props) => (
      <this.ThreadSenderContext.Provider value={props.msg}>
        <Original {...props} />
      </this.ThreadSenderContext.Provider>
    ));
    this.api.patchComponent('MessageSender', (Original) => (props: object) => {
      const msg = React.useContext(this.ThreadSenderContext);
      const dense = this.api.redux.useReduxState((state) => state.userPrefs?.messages_theme === 'dense');
      const sender = this.useSender(msg);
      if (!dense || !sender) return <Original {...props} />;
      return (
        <>
          <Original {...props} />
          <this.Badge {...sender} size={18} corner="inline" />
        </>
      );
    });

    if (this.config.hideMcpFooter) {
      this.api.patchComponent<{ msg?: SlackMessage }>('Blocks', (Original) => (props) => {
        const poster = this.useAppPoster(props.msg);
        const msg = poster && props.msg ? withoutMcpFooter(props.msg) : props.msg;
        return <Original {...props} msg={msg} />;
      });
    }
  }

  stop() {
    if (this.appTimer) clearTimeout(this.appTimer);
  }
}
