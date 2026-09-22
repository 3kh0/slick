// Show who actually sent a message when a relay bot posts on their behalf.
//
// The sender comes from metadata.event_payload when the store has it, else
// conversations.replies with include_all_metadata (Slack keeps event_type in
// the store but drops the payload). Results are cached and failures
// remembered, or every store update would retry every unresolved message.

import { SlickPlugin, type SlackAttachment } from '$slick';
import { RELAY_BOTS, type RelayedMessage } from './bots.ts';
import * as meta from './meta.ts';

const USER_ID = /^[UW][A-Z0-9]+$/;
/** A forward carries no bot id of its own, so this link is the only clue. */
const SERVICE_LINK = /\/services\/(B[A-Z0-9]+)/;
const SENDER_TTL_MS = 30 * 24 * 60 * 60 * 1000;
/** A screenful of lookups resolves together; repaint once, after they settle. */
const REPAINT_DEBOUNCE_MS = 100;

type SearchResult = { messages?: RelayedMessage[] };

export default class ShowRealUser extends SlickPlugin<typeof meta.settings> {
  static readonly id = meta.id;
  static readonly pluginName = meta.pluginName;
  static readonly description = meta.description;
  static readonly defaultEnabled = meta.defaultEnabled;
  static readonly settings = meta.settings;

  /** `channel:ts` -> sender, or null once the bot is known to name none. */
  private senders = this.api.Cache<string | null>('relay_senders', SENDER_TTL_MS);
  private failed = new Set<string>();
  private repaintTimer: ReturnType<typeof setTimeout> | null = null;

  private relay(msg: RelayedMessage | undefined) {
    return msg?.bot_id ? RELAY_BOTS[msg.bot_id] : undefined;
  }

  private validId(value: unknown): string | undefined {
    return typeof value === 'string' && USER_ID.test(value) ? value : undefined;
  }

  private senderOf(channel: string, ts: string): string | undefined {
    const key = `${channel}:${ts}`;
    const known = this.senders.peek(key);
    if (known !== undefined) return known ?? undefined;
    if (!this.failed.has(key)) void this.lookUp(key);
    return undefined;
  }

  private async lookUp(key: string) {
    const [channel, ts] = key.split(':');
    try {
      // The cache dedups in-flight lookups, so a repeat read costs nothing.
      await this.senders.get(key, async () => {
        const response = await this.api.userAPI<{ messages?: RelayedMessage[] }>(
          'conversations.replies',
          { channel, ts, limit: '1', inclusive: 'true', include_all_metadata: 'true' },
          { rateLimitRetries: 3, signal: this.api.signal },
        );
        const found = response.messages?.find((msg) => msg.ts === ts);
        const relay = this.relay(found);
        return (relay && this.validId(relay(found as RelayedMessage))) ?? null;
      });
    } catch (error) {
      this.failed.add(key);
      this.log('could not look up sender for', key, error);
      return;
    }

    if (this.repaintTimer) clearTimeout(this.repaintTimer);
    this.repaintTimer = setTimeout(() => {
      if (!this.api.signal.aborted) this.api.redux.refresh();
    }, REPAINT_DEBOUNCE_MS);
  }

  private asForwardedBy(attachment: SlackAttachment): SlackAttachment {
    if (!attachment?.channel_id || !attachment.ts) return attachment;

    const botId = SERVICE_LINK.exec(attachment.author_link ?? '')?.[1];
    if (!botId || !RELAY_BOTS[botId]) return attachment;

    const user = this.senderOf(attachment.channel_id, attachment.ts);
    if (!user) return attachment;

    const profile = this.api.members.getCachedMember(user)?.profile;
    const forwarded: SlackAttachment = {
      ...attachment,
      author_id: user,
      author_name: profile?.display_name || profile?.real_name || attachment.author_name,
      author_icon: profile?.image_48 ?? attachment.author_icon,
      author_link: this.profileLink(attachment.author_link, user),
    };
    delete forwarded.author_subname;
    return forwarded;
  }

  private profileLink(link: string | undefined, user: string): string | undefined {
    try {
      return `${new URL(link ?? '').origin}/team/${user}`;
    } catch {
      return link;
    }
  }

  private fixed(msg: RelayedMessage | undefined, channel = msg?.channel, ts = msg?.ts): RelayedMessage | undefined {
    if (!msg) return msg;

    let out = msg;
    const relay = this.relay(msg);
    if (relay) {
      const user = this.validId(relay(msg)) ?? (channel && ts ? this.senderOf(channel, ts) : undefined);
      if (user) out = this.api.messages.modifyMessageObject(msg, { sentBy: user });
    }

    // A message can forward a relayed one without being relayed itself.
    const attachments = out.attachments;
    if (Array.isArray(attachments)) {
      const next = attachments.map((attachment) => this.asForwardedBy(attachment));
      if (next.some((attachment, i) => attachment !== attachments[i])) out = { ...out, attachments: next };
    }
    return out;
  }

  // Block Kit stays attributed to the bot: interaction payloads are keyed on
  // the owning app, so its buttons would break otherwise.
  private withBot(msg: RelayedMessage | undefined) {
    const bot = msg?.slick_bot_id;
    if (!msg || msg.bot_id || typeof bot !== 'string') return msg;

    const stored =
      typeof msg.channel === 'string' && msg.ts ? this.api.messages.getRawMessage(msg.channel, msg.ts) : undefined;
    return { ...msg, bot_id: bot, ...(stored?.bot_profile && { bot_profile: stored.bot_profile }) };
  }

  start() {
    // `messages` nests a channel deep, so each channel's bucket is mapped too.
    this.api.redux.patchSlice<object>('messages', (channelId, bucket) => {
      if (!bucket || typeof bucket !== 'object') return bucket;
      return this.api.redux.mapEntries<RelayedMessage>(bucket, (ts, msg) => this.fixed(msg, channelId, ts));
    });
    this.api.redux.refresh();

    // These receive msg as a prop rather than reading the store.
    for (const name of ['MessageWrapper', 'ThreadRootGeneric', 'ActivityItem']) {
      this.api.patchComponent<{ msg?: RelayedMessage }>(name, (Original) => (props) => {
        const version = this.api.redux.usePatchVersion();
        const msg = React.useMemo(() => this.fixed(props.msg), [props.msg, version]);
        return <Original {...props} msg={msg} />;
      });
    }

    this.api.patchComponent<{ msg?: RelayedMessage }>('Blocks', (Original) => (props) => (
      <Original {...props} msg={this.withBot(props.msg)} />
    ));

    // Search keeps its own copies, which carry the bot's id as the sender.
    this.api.patchComponent<{ result?: SearchResult }>('MessageListItem', (Original) => (props) => {
      const version = this.api.redux.usePatchVersion();
      const result = React.useMemo(() => {
        const found = props.result?.messages;
        if (!found?.length) return props.result;
        const fixed = found.map((msg) => this.fixed(msg) ?? msg);
        return fixed.some((msg, i) => msg !== found[i]) ? { ...props.result, messages: fixed } : props.result;
      }, [props.result, version]);
      return <Original {...props} result={result} />;
    });
  }

  stop() {
    if (this.repaintTimer) clearTimeout(this.repaintTimer);
    this.repaintTimer = null;
  }
}
