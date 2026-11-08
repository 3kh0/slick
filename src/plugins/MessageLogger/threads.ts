import type { SlackMessage } from '$slick';

export function withLoggedReplies(messages: SlackMessage[]): SlackMessage[] {
  const replies = new Map<string, SlackMessage[]>();
  for (const message of messages) {
    if (!message.thread_ts || message.thread_ts === message.ts) continue;
    const key = `${message.channel}:${message.thread_ts}`;
    const group = replies.get(key) ?? [];
    group.push(message);
    replies.set(key, group);
  }
  return messages.map((message) => {
    const group = replies.get(`${message.channel}:${message.ts}`);
    if (!group?.length) return message;
    const users = [
      ...new Set([
        ...(Array.isArray(message.reply_users) ? message.reply_users : []),
        ...group.map((reply) => reply.user).filter(Boolean),
      ]),
    ];
    return {
      ...message,
      thread_ts: message.ts,
      reply_count: Math.max(Number(message.reply_count) || 0, group.length),
      reply_users: users,
      reply_users_count: Math.max(Number(message.reply_users_count) || 0, users.length),
      latest_reply: [message.latest_reply, ...group.map((reply) => reply.ts)].filter(Boolean).toSorted().at(-1),
    };
  });
}
