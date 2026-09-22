// `state.messages` is nested two levels (`messages[channelId][ts]`), and Slack
// draws a conversation from `channelHistory[key].slices[].timestamps`, not by
// enumerating `messages`. Re-inserting a message takes both patches; a body
// missing from the timestamps is never drawn.
//
// Ported from Taut's `app/slack/messages.ts`.

import {
  historyKeyChannel,
  historyKeyThread,
  inHistory,
  sliceCovers,
  withTimestamps,
  type ChannelHistory,
  type HistorySlice,
} from './messageHistory.ts';
import { getPatchVersion, getRawState, mapEntries, patchSlice, reduxReady } from './redux.ts';
import { waitForExport } from './webpack.ts';

export { inHistory, withTimestamps, type ChannelHistory, type HistorySlice } from './messageHistory.ts';

export type SlackBotIcons = {
  image_36?: string;
  image_48?: string;
  image_72?: string;
  emoji?: string;
};

export type SlackBot = {
  id?: string;
  name?: string;
  app_id?: string;
  user_id?: string;
  deleted?: boolean;
  icons?: SlackBotIcons;
  [key: string]: unknown;
};

export type SlackMessage = {
  channel?: string;
  ts?: string;
  user?: string;
  bot_id?: string;
  app_id?: string;
  username?: string;
  icons?: SlackBotIcons;
  bot_profile?: SlackBot;
  subtype?: string;
  thread_ts?: string;
  attachments?: SlackAttachment[];
  [key: string]: unknown;
};

/** One row of the activity feed. */
export type SlackActivityItem = {
  type?: string;
  channelId?: string;
  messageTs?: string;
  [key: string]: unknown;
};

/** Forwarded message data. */
export type SlackAttachment = {
  author_id?: string;
  author_name?: string;
  /** The name the forwarded message was posted under, when it overrode one. */
  author_subname?: string;
  author_icon?: string;
  author_link?: string;
  channel_id?: string;
  ts?: string;
  [key: string]: unknown;
};

export const getMessageBotId = (msg: SlackMessage | undefined): string | undefined =>
  msg?.bot_id ?? msg?.bot_profile?.id ?? (msg?.slick_bot_id as string | undefined);

export function getRawMessage(channel: string, ts: string): SlackMessage | undefined {
  return getRawState()?.messages?.[channel]?.[ts];
}

/** The original stored version of a rendered message, before Slick's patches. */
export const asRawMessage = (msg: SlackMessage | undefined): SlackMessage | undefined =>
  (typeof msg?.channel === 'string' && msg.ts && getRawMessage(msg.channel, msg.ts)) || msg;

export function modifyMessageObject(
  message: SlackMessage,
  edits: {
    /** Credit the message to this member, dropping every trace of the bot, except slick_bot_id. */
    sentBy?: string;
  },
): SlackMessage {
  const next: SlackMessage = { ...message };
  if (edits.sentBy === undefined) return next;

  next.user = edits.sentBy;
  const bot = getMessageBotId(message);
  if (bot) next.slick_bot_id = bot;
  // Slack tests some of these with `in`, so delete rather than blank them.
  for (const key of ['bot_id', 'app_id', 'username', 'icons', 'bot_profile', 'display_as_bot'] as const)
    delete next[key];
  if (next.subtype === 'bot_message') delete next.subtype;
  return next;
}

export const messageDiagnostics = { historyShapeFailures: 0 };
let historyShapeAsserted = false;

function failHistoryShape(detail: string): void {
  messageDiagnostics.historyShapeFailures++;
  if (historyShapeAsserted) return;
  historyShapeAsserted = true;
  console.assert(
    false,
    `[slick] injectMessages: ${detail}. Deleted messages will stop appearing until this is updated. ` +
      `Failure count: ${messageDiagnostics.historyShapeFailures}.`,
  );
}

function diagnoseHistory(entry: ChannelHistory, added: string[], next: HistorySlice[]): void {
  if (!added.length) return;
  if (!Array.isArray(entry.slices)) {
    failHistoryShape('channelHistory.slices is not an array');
    return;
  }

  const rendered = new Set<string>();
  for (const slice of next) {
    if (!Array.isArray(slice.timestamps)) continue;
    for (const ts of slice.timestamps) rendered.add(ts);
  }

  let expected = 0;
  let placed = 0;
  for (const ts of added) {
    const covered = (entry.slices ?? []).some((slice, position) => sliceCovers(entry, slice, position, ts));
    if (!covered) continue;
    expected++;
    if (rendered.has(ts)) placed++;
  }

  if (expected > 0 && placed === 0) {
    failHistoryShape(
      `placed 0/${expected} injected timestamps into channelHistory (injected=${added.length}); slices[].timestamps may have changed shape`,
    );
  }
}

export function injectMessages(getMessages: () => Iterable<SlackMessage>): () => void {
  let indexedAt = -1;
  let byChannel = new Map<string, Map<string, SlackMessage>>();

  const index = () => {
    if (indexedAt === getPatchVersion()) return byChannel;
    indexedAt = getPatchVersion();
    byChannel = new Map();
    for (const msg of getMessages()) {
      if (typeof msg?.channel !== 'string' || typeof msg.ts !== 'string') continue;
      let bucket = byChannel.get(msg.channel);
      if (!bucket) {
        bucket = new Map();
        byChannel.set(msg.channel, bucket);
      }
      bucket.set(msg.ts, msg);
    }
    return byChannel;
  };

  const unpatchMessages = patchSlice<object>(
    'messages',
    (channel, bucket) => {
      const injected = index().get(channel);
      if (!injected?.size) return bucket;
      return mapEntries<SlackMessage>(
        bucket ?? {},
        (ts, msg) => injected.get(ts) ?? msg,
        () => injected.keys(),
      );
    },
    () => index().keys(),
  );

  const unpatchHistory = patchSlice<ChannelHistory>('channelHistory', (key, entry) => {
    const injected = index().get(historyKeyChannel(key));
    if (!injected?.size) return entry;
    if (!entry || !Array.isArray(entry.slices)) {
      if (entry) failHistoryShape('channelHistory entry exists but slices is missing or is not an array');
      return entry;
    }
    const thread = historyKeyThread(key);
    const added = [...injected.values()].filter((msg) => inHistory(msg, thread)).map((msg) => msg.ts as string);
    if (!added.length) return entry;
    const next = withTimestamps(entry, added);
    diagnoseHistory(entry, added, next);
    return next === entry.slices ? entry : { ...entry, slices: next };
  });

  return () => {
    unpatchMessages();
    unpatchHistory();
  };
}

type SenderDetails = (
  state: any,
  item: SlackActivityItem | undefined,
) => { senderType?: string; senderId?: string } | undefined;

export const messagesReady = (async () => {
  const { useReduxState } = await reduxReady;
  // The activity view is a lazy chunk.
  let readSender: SenderDetails | undefined;
  void waitForExport<SenderDetails>(
    (exp: any) => typeof exp === 'function' && exp.name === 'getSenderDetailsFromActivityItem',
  ).then((found) => {
    readSender = found;
  });

  function useActivityMessage(item: SlackActivityItem | undefined): SlackMessage | undefined {
    const drawn = useReduxState<string | undefined>((state) => {
      const sender = readSender?.(state, item);
      return sender?.senderType === 'app' ? undefined : sender?.senderId;
    });
    const msg = item?.channelId && item.messageTs ? getRawMessage(item.channelId, item.messageTs) : undefined;
    return msg && { ...msg, user: drawn };
  }

  function useMessageBot(msg: SlackMessage | undefined): SlackBot | undefined {
    const botId = useReduxState(() => getMessageBotId(asRawMessage(msg)));
    const stored = useReduxState<SlackBot | undefined>((state) => (botId ? state.bots?.[botId] : undefined));
    if (!botId) return undefined;
    return stored ?? asRawMessage(msg)?.bot_profile ?? { id: botId };
  }

  return {
    getRawMessage,
    asRawMessage,
    getMessageBotId,
    injectMessages,
    diagnostics: messageDiagnostics,
    modifyMessageObject,
    useActivityMessage,
    useMessageBot,
  };
})();

export type MessagesAPI = Awaited<typeof messagesReady>;
