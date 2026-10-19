// Copy-on-write filters preserve raw data and identity for reversible, memoized views.
import type { SlackMessage } from '../../app/slack/messages.ts';
import type { ChannelHistory } from '../../app/slack/messageHistory.ts';

export type Blocked = ReadonlySet<string>;
export type Data = Record<string, any>;
export const record = (value: unknown): value is Data => !!value && typeof value === 'object' && !Array.isArray(value);
export const isBlocked = (value: unknown, blocked: Blocked): boolean => typeof value === 'string' && blocked.has(value);
export const isHuddle = (message: Data | undefined): boolean =>
  message?.subtype === 'huddle_thread' || message?.subtype === 'sh_room_created' || message?.subtype === 'huddle';
export const hidesMessage = (message: Data | undefined, blocked: Blocked): boolean =>
  !!message &&
  !isHuddle(message) &&
  (isBlocked(message.user, blocked) ||
    isBlocked(message.bot_profile?.user_id, blocked) ||
    isBlocked(message.delegate_sender_user_id, blocked));

export function keep<T>(items: T[], predicate: (item: T) => boolean): T[] {
  const next = items.filter(predicate);
  return next.length === items.length ? items : next;
}

export function mapSame<T>(items: T[], transform: (item: T) => T): T[] {
  const next = items.map(transform);
  return next.some((item, index) => item !== items[index]) ? next : items;
}

// Counts can exceed the supplied user list. Preserve the unknown reactors
export function filterReaction<T extends Data>(reaction: T, blocked: Blocked): T | null {
  if (!Array.isArray(reaction.users)) return reaction;
  const users = keep(reaction.users, (id) => !isBlocked(id, blocked));
  const removed = reaction.users.length - users.length;
  const nested = Array.isArray(reaction.reactions) ? filterReactions(reaction.reactions, blocked) : reaction.reactions;
  if (!removed && nested === reaction.reactions) return reaction;
  // Grouped emoji deduplicate users, but their nested variants count separately.
  const total = (items: Data[]) =>
    items.reduce((sum, item) => sum + (typeof item.count === 'number' ? item.count : (item.users?.length ?? 0)), 0);
  const nestedRemoved =
    Array.isArray(reaction.reactions) && nested !== reaction.reactions ? total(reaction.reactions) - total(nested) : 0;
  const count = Math.max(
    0,
    (typeof reaction.count === 'number' ? reaction.count : reaction.users.length) - Math.max(removed, nestedRemoved),
  );
  if (!count) return null;
  // Regenerate tooltips from filtered reactions instead of exposing cached names.
  return { ...reaction, users, count, ...(nested ? { reactions: nested } : {}), tooltip: undefined };
}

export function filterReactions<T extends Data>(reactions: T[], blocked: Blocked): T[] {
  const next = reactions.map((reaction) => filterReaction(reaction, blocked)).filter((reaction) => reaction !== null);
  return next.length === reactions.length && next.every((reaction, i) => reaction === reactions[i]) ? reactions : next;
}

// Rich-text mentions are structured user nodes plain-text fallback uses <@ID>
export function filterContent(value: unknown, blocked: Blocked): any {
  if (typeof value === 'string')
    return value.replace(/<@([UW][A-Z0-9]+)(?:\|[^>]*)?>/g, (mention, id) => (isBlocked(id, blocked) ? '' : mention));
  if (Array.isArray(value))
    return mapSame(
      keep(value, (item) => !(record(item) && item.type === 'user' && isBlocked(item.user_id, blocked))),
      (item) => filterContent(item, blocked),
    );
  if (!record(value)) return value;
  let out = value;
  for (const key of ['elements', 'text', 'fields', 'blocks', 'pretext', 'fallback', 'title', 'footer']) {
    if (!(key in value)) continue;
    const next = filterContent(value[key], blocked);
    if (next !== value[key]) {
      if (out === value) out = { ...value };
      out[key] = next;
    }
  }
  return out;
}

export function filterMessage<T extends SlackMessage>(message: T, blocked: Blocked): T {
  if (!blocked.size || isHuddle(message)) return message;
  let out = message;
  const set = (key: string, value: unknown) => {
    if (value === message[key]) return;
    if (out === message) out = { ...message };
    (out as Data)[key] = value;
  };
  for (const key of ['text', 'blocks']) set(key, filterContent(message[key], blocked));
  if (Array.isArray(message.attachments)) {
    set(
      'attachments',
      mapSame(
        keep(message.attachments, (item) => !isBlocked(item.author_id, blocked) && !isBlocked(item.user, blocked)),
        (item) => filterContent(item, blocked),
      ),
    );
  }
  if (Array.isArray(message.files))
    set(
      'files',
      keep(message.files, (file) => !record(file) || !isBlocked(file.user, blocked)),
    );
  if (Array.isArray(message.reactions)) set('reactions', filterReactions(message.reactions, blocked));
  if (Array.isArray(message.reply_users)) {
    const users = keep(message.reply_users, (id) => !isBlocked(id, blocked));
    set('reply_users', users);
    if (users !== message.reply_users && typeof message.reply_users_count === 'number')
      set(
        'reply_users_count',
        Math.max(users.length, message.reply_users_count - (message.reply_users.length - users.length)),
      );
    // Slack caps author lists; hide the bar only if every author is known and blocked.
    if (
      users.length === 0 &&
      message.reply_users.length > 0 &&
      message.reply_users_count === message.reply_users.length
    ) {
      set('reply_count', 0);
      set('latest_reply', undefined);
    }
  }
  if (Array.isArray(message.replies)) {
    const replies = keep(message.replies, (reply) => !hidesMessage(reply, blocked));
    set('replies', replies);
    if (replies !== message.replies && out.reply_count !== 0 && typeof message.reply_count === 'number')
      set('reply_count', Math.max(0, message.reply_count - (message.replies.length - replies.length)));
    if (message.replies.some((reply) => reply.ts === message.latest_reply && hidesMessage(reply, blocked)))
      set('latest_reply', replies.at(-1)?.ts);
  }
  return out;
}

export function filterHistory(history: ChannelHistory, messages: Data | undefined, blocked: Blocked): ChannelHistory {
  if (!messages || !Array.isArray(history.slices)) return history;
  const slices = mapSame(history.slices, (slice) => {
    if (!Array.isArray(slice.timestamps)) return slice;
    const timestamps = keep(slice.timestamps, (ts) => !hidesMessage(messages[ts], blocked));
    return timestamps === slice.timestamps ? slice : { ...slice, timestamps };
  });
  return slices === history.slices ? history : { ...history, slices };
}

/** mapEntries transforms values but retains their enumerable keys. Typing
 * selectors dereference every value, so omitted people must have no key at all. */
export function filterTyping<T extends Data>(typing: T, blocked: Blocked): T {
  let removed = false;
  const visible: Data = Object.create(null);
  // Slack maps can inherit entries from earlier snapshots.
  for (const key in typing) {
    const typer = typing[key];
    if (isBlocked(typer?.memberId, blocked)) removed = true;
    else visible[key] = typer;
  }
  return removed ? (visible as T) : typing;
}

export const isThreadActivity = (item: Data | undefined): boolean =>
  !!item?.threadTs && (item.type === 'thread_v2' || item.type === 'thread');

/** Keep thread identity/read state; replace blocked previews with a loaded visible reply or root. */
export function filterThreadActivity<T extends Data>(item: T, state: Data, blocked: Blocked): T {
  if (!blocked.size || !isThreadActivity(item)) return item;
  const messages = state.messages?.[item.channelId];
  let visible: Data | undefined;
  let removedUnread = 0;
  const latest = Math.max(...[item.latestTs, item.feedTs, item.messageTs, item.threadTs].map((ts) => Number(ts) || 0));
  for (const ts in messages) {
    const message = messages[ts];
    if (!message || (ts !== item.threadTs && message.thread_ts !== item.threadTs) || Number(ts) > latest) continue;
    if (hidesMessage(message, blocked)) {
      if (ts !== item.threadTs && item.minUnreadTs && Number(ts) >= Number(item.minUnreadTs)) removedUnread++;
    } else if (!visible || Number(ts) > Number(visible.ts)) visible = message;
  }
  let out = item;
  const set = (key: string, value: unknown) => {
    if (item[key] === value) return;
    if (out === item) out = { ...item };
    (out as Data)[key] = value;
  };
  for (const key of ['messageTs', 'feedTs', 'latestTs', 'minUnreadTs']) {
    if (hidesMessage(messages?.[item[key]], blocked)) set(key, visible?.ts);
  }
  if (hidesMessage(item.message, blocked)) set('message', visible);
  for (const key of ['user', 'userId']) if (isBlocked(item[key], blocked)) set(key, visible?.user);
  if (removedUnread && typeof item.unreadCount === 'number')
    set('unreadCount', Math.max(0, item.unreadCount - removedUnread));
  return out;
}

export function hidesActivity(item: Data | undefined, state: Data, blocked: Blocked): boolean {
  if (!item || /huddle|call/i.test(item.type ?? '')) return false;
  if (blockedDm(state.channels?.[item.channelId], blocked)) return true;
  if (isThreadActivity(item)) return false;
  // For reactions the actor, not the author of the reacted-to message, is the sender.
  if (isBlocked(item.reactionUser, blocked)) return true;
  for (const id of [
    item.userId,
    item.user,
    item.inviter,
    item.invite,
    item.quietlyAddedToChannelPayload?.inviter_user_id,
    item.unjoinedChannelMentionPayload?.inviter_user_id,
    item.listUserMentionPayload?.mentioned_by,
    item.listEditPayload?.edited_by,
    item.listPayload?.assigned_by,
  ]) {
    if (isBlocked(id, blocked)) return true;
  }
  const messages = state.messages?.[item.channelId];
  return (
    hidesMessage(item.message, blocked) ||
    hidesMessage(messages?.[item.messageTs ?? item.latestTs ?? item.feedTs ?? item.ts], blocked)
  );
}

export function blockedDm(channel: Data | undefined, blocked: Blocked): boolean {
  return channel?.is_im === true && isBlocked(channel.user, blocked);
}

/** Global search/quick switcher suggestions have a different shape from Texty. */
export function hidesSuggestion(suggestion: Data, blocked: Blocked): boolean {
  if (suggestion.is_type_huddle || suggestion.type === 'huddle') return false;
  const member = suggestion.user ?? suggestion.member;
  if (
    [suggestion.id, suggestion.item?.id, member?.id, member, suggestion.lastTokenMemberOrNull?.id].some((id) =>
      isBlocked(id, blocked),
    )
  )
    return true;
  for (const channel of [suggestion.im, suggestion.channel, suggestion.mpim, suggestion.item]) {
    if (blockedDm(channel, blocked)) return true;
    if (
      (channel?.is_mpim || suggestion.type === 'mpim') &&
      channel?.members?.some((id: unknown) => isBlocked(id, blocked))
    )
      return true;
  }
  return (
    suggestion.suggestion_replacement_ops?.some((op: Data) =>
      isBlocked(op.attributes?.slacksearchfilter?.entityId, blocked),
    ) ?? false
  );
}

/** Keep Slack's upstream selection in its original coordinates. Both the menu
 * and input (including ghost text / Enter) must use this same projection. */
export function projectSuggestions(items: Data[], selected: number | null | undefined, blocked: Blocked) {
  const indices: number[] = [];
  const visible = items.filter((item, index) => {
    if (hidesSuggestion(item, blocked)) return false;
    indices.push(index);
    return true;
  });
  const suggestions = visible.length === items.length ? items : visible;
  const current = selected ?? 0;
  const needsSync = items.length > 0 && !indices.includes(current);
  const nextSourceIndex = needsSync ? (indices.find((index) => index >= current) ?? indices[0] ?? null) : selected;
  const selectedIndex = selected == null && !needsSync ? null : indices.indexOf(nextSourceIndex ?? -1);
  return {
    suggestions,
    selectedIndex: selectedIndex === -1 ? null : selectedIndex,
    needsSync,
    nextSourceIndex,
    canAccept: !needsSync && (items.length === 0 || suggestions.length > 0),
    sourceIndex: (index: number | null) =>
      index == null ? (indices[0] === 0 ? null : (indices[0] ?? null)) : (indices[index] ?? null),
  };
}

/** Slack search returns an array with a second, remote result on `.promise`. */
export function filterMemberResults(value: unknown, getBlocked: () => Blocked): any {
  if (!Array.isArray(value)) return value;
  const blocked = getBlocked();
  const visible = keep(value, (result) => !isBlocked(result?.item?.id ?? result?.id, blocked));
  const pending = (value as unknown as Data).promise;
  if (visible === value && typeof pending?.then !== 'function') return value;
  const next = [...visible];
  // Preserve search metadata without copying the old array indices or length.
  for (const key of Reflect.ownKeys(value)) {
    if (key === 'length' || key === 'promise' || (typeof key === 'string' && /^\d+$/.test(key))) continue;
    Object.defineProperty(next, key, Object.getOwnPropertyDescriptor(value, key)!);
  }
  if (typeof pending?.then === 'function')
    Object.defineProperty(next, 'promise', {
      configurable: true,
      enumerable: true,
      writable: true,
      value: pending.then((result: unknown) => filterMemberResults(result, getBlocked)),
    });
  return next;
}
