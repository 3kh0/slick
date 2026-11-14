import { z } from 'zod';
import type { AddTool, Api } from './extraTools.ts';
import type { AgentBackend } from './tools.ts';

const text = z.string().min(1);
const ts = z.string().regex(/^\d+\.\d{6}$/);
const object = z.record(z.string(), z.json());
const limit = z.number().int().min(1).max(100).default(50);
const cursor = z.string().optional();

export function addAdvancedTools(add: AddTool, api: Api, backend: AgentBackend) {
  const mapped = (name: string, description: string, method: string, shape: z.ZodRawShape, readOnly = true) =>
    add(name, description, shape, readOnly, (args, signal) => api(method, args, signal));
  mapped(
    'slack_list_scheduled_messages',
    'List scheduled messages and cancellation IDs, with cursor pagination.',
    'chat.scheduledMessages.list',
    { channel: text.optional(), limit, cursor },
  );
  mapped(
    'slack_cancel_scheduled_message',
    'Cancel a scheduled message before it is sent.',
    'chat.deleteScheduledMessage',
    { channel: text, scheduled_message_id: text },
    false,
  );
  for (const action of ['join', 'leave'] as const)
    mapped(
      `slack_${action}_channel`,
      `${action === 'join' ? 'Join' : 'Leave'} a Slack channel as yourself.`,
      `conversations.${action}`,
      { channel: text },
      false,
    );
  mapped(
    'slack_invite_to_channel',
    'Invite comma-separated user IDs to a channel.',
    'conversations.invite',
    { channel: text, users: text },
    false,
  );
  mapped('slack_rename_channel', 'Rename a channel.', 'conversations.rename', { channel: text, name: text }, false);
  mapped(
    'slack_set_channel_topic',
    'Set or clear a channel topic.',
    'conversations.setTopic',
    { channel: text, topic: z.string() },
    false,
  );
  mapped(
    'slack_set_channel_purpose',
    'Set or clear a channel purpose.',
    'conversations.setPurpose',
    { channel: text, purpose: z.string() },
    false,
  );
  mapped('slack_list_pins', 'Read messages pinned to a channel.', 'pins.list', { channel: text });
  for (const action of ['add', 'remove'] as const)
    mapped(
      `slack_${action}_pin`,
      `${action === 'add' ? 'Pin' : 'Unpin'} a message for everyone in the channel.`,
      `pins.${action}`,
      { channel: text, timestamp: ts },
      false,
    );
  mapped('slack_list_bookmarks', 'List bookmarks in a channel.', 'bookmarks.list', { channel_id: text });
  mapped(
    'slack_add_bookmark',
    'Add a link bookmark to a channel.',
    'bookmarks.add',
    { channel_id: text, title: text, type: z.literal('link').default('link'), link: z.url(), emoji: text.optional() },
    false,
  );
  mapped(
    'slack_edit_bookmark',
    'Edit a channel bookmark.',
    'bookmarks.edit',
    {
      channel_id: text,
      bookmark_id: text,
      title: text.optional(),
      link: z.url().optional(),
      emoji: z.string().optional(),
    },
    false,
  );
  mapped(
    'slack_remove_bookmark',
    'Remove a channel bookmark.',
    'bookmarks.remove',
    { channel_id: text, bookmark_id: text },
    false,
  );
  mapped('slack_list_records', 'Read records in a Slack List, with cursor pagination.', 'slackLists.items.list', {
    list_id: text,
    limit,
    cursor,
  });
  mapped('slack_get_record', 'Read a record and its fields in a Slack List.', 'slackLists.items.info', {
    list_id: text,
    id: text,
  });
  mapped(
    'slack_create_record',
    'Create a Slack List record. Field objects use Slack column IDs and typed cell values.',
    'slackLists.items.create',
    { list_id: text, initial_fields: z.array(object).max(100).default([]), parent_item_id: text.optional() },
    false,
  );
  mapped(
    'slack_update_records',
    'Update up to 100 cells in a Slack List. Each cell includes row_id and column_id plus its typed value.',
    'slackLists.items.update',
    {
      list_id: text,
      cells: z
        .array(z.looseObject({ row_id: text, column_id: text }))
        .min(1)
        .max(100),
    },
    false,
  );
  mapped(
    'slack_delete_record',
    'Delete one Slack List record.',
    'slackLists.items.delete',
    { list_id: text, id: text },
    false,
  );
  add(
    'slack_read_canvas',
    'Read a canvas as Markdown or HTML without opening it. Large content is truncated explicitly.',
    {
      canvas_id: text,
      content_type: z.enum(['markdown', 'html']).default('markdown'),
      max_chars: z.number().int().min(100).max(100000).default(30000),
    },
    true,
    async (args, signal) => {
      const { max_chars, ...params } = args;
      const response = (await api('canvases.getContent', params, signal)) as any;
      return {
        ...response,
        content: typeof response.content === 'string' ? response.content.slice(0, max_chars) : response.content,
        truncated: typeof response.content === 'string' && response.content.length > max_chars,
      };
    },
  );
  add(
    'slack_resolve_person',
    'Resolve a user ID, mention, email, profile link, or name. Searches multiple directory pages, reports ambiguities, and returns a continuation cursor when incomplete.',
    { query: text, cursor, max_pages: z.number().int().min(1).max(10).default(5) },
    true,
    (args, signal) => resolveDirectory('person', args, api, signal),
  );
  add(
    'slack_resolve_channel',
    'Resolve a channel ID, mention, Slack link, or name across directory pages. Never silently selects among ambiguous matches.',
    { query: text, cursor, max_pages: z.number().int().min(1).max(10).default(5) },
    true,
    (args, signal) => resolveDirectory('channel', args, api, signal),
  );
  add(
    'slack_get_message_context',
    'Resolve a message permalink or channel+ts into the exact message, nearby messages, its thread, channel details, and author names. Does not mark read. Thread pagination is preserved.',
    {
      url: z.url().optional(),
      channel: text.optional(),
      ts: ts.optional(),
      nearby: z.number().int().min(0).max(20).default(5),
      thread_limit: z.number().int().min(1).max(100).default(30),
    },
    true,
    async (args, signal) => {
      const link = args.url
        ? ((await backend('resolve_link', { window_id: args.window_id, url: args.url }, signal)) as any)
        : {};
      const channel = link.channel_id ?? args.channel;
      const timestamp = link.message_ts ?? args.ts;
      if (!channel || !timestamp) throw new Error('Supply a message URL or channel and ts');
      const call = (method: string, params: Record<string, unknown>) =>
        api(method, { window_id: args.window_id, ...params }, signal) as Promise<any>;
      const exact = await call('conversations.history', {
        channel,
        oldest: timestamp,
        latest: timestamp,
        inclusive: true,
        limit: 1,
      });
      const message = exact.messages?.find((item: any) => item.ts === timestamp);
      if (!message) throw new Error('Message not found or inaccessible');
      const before = args.nearby
        ? await call('conversations.history', { channel, latest: timestamp, inclusive: false, limit: args.nearby })
        : { messages: [] };
      const afterMessages: any[] = [];
      let afterCursor: string | undefined;
      let afterTruncated = false;
      if (args.nearby)
        for (let page = 0; page < 5; page++) {
          const response = await call('conversations.history', {
            channel,
            oldest: timestamp,
            inclusive: false,
            limit: 100,
            ...(afterCursor ? { cursor: afterCursor } : {}),
          });
          afterMessages.push(...(response.messages ?? []));
          afterCursor = response.response_metadata?.next_cursor;
          afterTruncated = !!response.has_more;
          if (!afterCursor) break;
        }
      const after = afterTruncated
        ? []
        : afterMessages.toSorted((a, b) => Number(a.ts) - Number(b.ts)).slice(0, args.nearby);
      const thread = await call('conversations.replies', {
        channel,
        ts: message.thread_ts ?? timestamp,
        limit: args.thread_limit,
      });
      const info = await call('conversations.info', { channel });
      const authors = [
        ...new Set<string>(
          [message, ...(before.messages ?? []), ...after, ...(thread.messages ?? [])]
            .map((item: any) => item.user)
            .filter(Boolean),
        ),
      ].slice(0, 50);
      const people: Record<string, unknown> = {};
      for (const user of authors) {
        try {
          const response = await call('users.info', { user });
          people[user] = {
            name: response.user?.name,
            display_name: response.user?.profile?.display_name,
            real_name: response.user?.real_name,
          };
        } catch {
          people[user] = { unavailable: true };
        }
      }
      return {
        channel: info.channel,
        message,
        before: before.messages?.toReversed(),
        after,
        after_truncated: afterTruncated,
        thread,
        people,
      };
    },
  );
  add(
    'slack_subscribe_events',
    'Create an explicit bounded event buffer. Poll with the returned subscription_id and cursor; events arriving between polls are retained. Handles expire after 30 minutes of inactivity or renderer restart.',
    {
      event_type: text.default('*'),
      channel: text.optional(),
      user: text.optional(),
      thread_ts: ts.optional(),
      include_content: z.boolean().default(false),
    },
    true,
    (args, signal) => backend('subscribe_events', args, signal),
  );
  add(
    'slack_poll_events',
    'Replay events after a cursor without consuming them. gap=true means the buffer overflowed; refresh Slack state. Retrying the same cursor is safe.',
    { subscription_id: text, cursor: text, limit },
    true,
    (args, signal) => backend('poll_events', args, signal),
  );
  add(
    'slack_unsubscribe_events',
    'Close an event buffer and release its listener.',
    { subscription_id: text },
    true,
    (args, signal) => backend('unsubscribe_events', args, signal),
  );
}

export async function resolveDirectory(
  kind: 'person' | 'channel',
  args: Record<string, any>,
  api: Api,
  signal: AbortSignal,
) {
  let query = args.query.trim();
  if (query.startsWith('https://') || query.startsWith('slack:')) {
    const url = new URL(query);
    if (url.protocol !== 'slack:' && (url.protocol !== 'https:' || !/(^|\.)slack\.com$/.test(url.hostname)))
      throw new Error('Expected a Slack link');
    query =
      url.searchParams.get('id') ??
      url.pathname.match(
        kind === 'person' ? /\/team\/([UW][A-Z0-9]+)/ : /\/(?:archives|client\/[^/]+)\/([CDG][A-Z0-9]+)/,
      )?.[1] ??
      '';
    if (!query) throw new Error('Link does not identify the requested entity');
  }
  query = query.replace(/^<[@#]([^>|]+)(?:\|[^>]+)?>$/, '$1').replace(/^[@#]/, '');
  const call = (method: string, params: Record<string, unknown>) =>
    api(method, { window_id: args.window_id, ...params }, signal) as Promise<any>;
  if ((kind === 'person' ? /^[UW][A-Z0-9]+$/ : /^[CDG][A-Z0-9]+$/).test(query)) {
    const response = await call(kind === 'person' ? 'users.info' : 'conversations.info', {
      [kind === 'person' ? 'user' : 'channel']: query,
    });
    return { matches: [response[kind === 'person' ? 'user' : 'channel']], ambiguous: false, complete: true };
  }
  if (kind === 'person' && query.includes('@')) {
    const response = await call('users.lookupByEmail', { email: query });
    return { matches: [response.user], ambiguous: false, complete: true };
  }
  const needle = query.toLowerCase();
  const matches: any[] = [];
  let next = args.cursor;
  let pages = 0;
  do {
    const response = await call(kind === 'person' ? 'users.list' : 'conversations.list', {
      limit: 200,
      ...(next ? { cursor: next } : {}),
      ...(kind === 'channel' ? { types: 'public_channel,private_channel', exclude_archived: true } : {}),
    });
    for (const entry of response[kind === 'person' ? 'members' : 'channels'] ?? []) {
      const names =
        kind === 'person'
          ? [entry.name, entry.real_name, entry.profile?.display_name, entry.profile?.real_name]
          : [entry.name];
      if (names.some((name) => typeof name === 'string' && name.toLowerCase().includes(needle)))
        matches.push({
          id: entry.id,
          name: entry.name,
          real_name: entry.real_name,
          display_name: entry.profile?.display_name,
          is_private: entry.is_private,
        });
    }
    next = response.response_metadata?.next_cursor;
    pages++;
  } while (next && pages < args.max_pages);
  return {
    matches,
    ambiguous: matches.length > 1,
    complete: !next,
    next_cursor: next || null,
    pages_scanned: pages,
  };
}
