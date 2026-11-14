import { z } from 'zod';
import type { AgentBackend } from './tools.ts';
import { isAbsolute } from 'node:path';

export type AddTool = (
  name: string,
  description: string,
  shape: z.ZodRawShape,
  readOnly: boolean,
  run: (args: Record<string, any>, signal: AbortSignal) => Promise<unknown>,
) => unknown;
export type Api = (method: string, args: Record<string, unknown>, signal: AbortSignal) => Promise<unknown>;
const text = z.string().min(1);
const ts = z.string().regex(/^\d+\.\d{6}$/);
const object = z.record(z.string(), z.json());
const composer = z.string().default('[data-qa=message_input] .ql-editor');
const localPath = text.refine(isAbsolute, 'Use an absolute local file path');

export function addExtraTools(add: AddTool, api: Api, backend: AgentBackend) {
  const feature = (name: string, description: string, action: string, shape: z.ZodRawShape, readOnly: boolean) =>
    add(name, description, shape, readOnly, (args, signal) => backend(action, args, signal));
  feature(
    'slack_get_unreads',
    'Get fresh unread conversation IDs, last-read/latest timestamps, and mention counts. This does not mark anything read. Paginate using next_offset.',
    'get_unreads',
    { offset: z.number().int().nonnegative().default(0), limit: z.number().int().min(1).max(200).default(50) },
    true,
  );
  add(
    'slack_mark_read',
    'Advance a conversation’s read marker through a specific message timestamp. This changes your Slack read state.',
    { channel: text, ts },
    false,
    (args, signal) => api('conversations.mark', args, signal),
  );
  feature(
    'slack_get_activity',
    'Read Activity mentions, thread replies, DMs, and reactions without marking them read. Set include_content=false for IDs/counts only. Follow response_metadata.next_cursor.',
    'get_activity',
    {
      limit: z.number().int().min(1).max(100).default(20),
      cursor: z.string().optional(),
      unread_only: z.boolean().default(false),
      include_content: z.boolean().default(true),
      types: z
        .array(
          z.enum([
            'at_user',
            'at_user_group',
            'at_channel',
            'at_everyone',
            'keyword',
            'thread_v2',
            'thread_reply',
            'dm',
            'mpdm',
            'message_reaction',
            'saved_reminder',
          ]),
        )
        .min(1)
        .default([
          'at_user',
          'at_user_group',
          'at_channel',
          'at_everyone',
          'keyword',
          'thread_v2',
          'dm',
          'message_reaction',
        ]),
    },
    true,
  );
  feature(
    'slack_wait_for_event',
    'Wait for a future Slack websocket event without polling message history. Filters are ANDed. Returns timed_out=true if no event arrives; repeat the wait to continue. Cancellation/disconnection removes the listener.',
    'wait_for_event',
    {
      event_type: text.default('message'),
      channel: text.optional(),
      user: text.optional(),
      thread_ts: ts.optional(),
      after_ts: ts.optional(),
      timeout_ms: z.number().int().min(100).max(25000).default(10000),
      include_content: z.boolean().default(true),
    },
    true,
  );
  feature(
    'slack_get_draft',
    'Read the currently visible composer draft as plain text and Quill Delta ops, including formatting and emoji. Does not send or navigate.',
    'get_draft',
    { target: composer },
    true,
  );
  feature(
    'slack_set_draft',
    'Replace or append to the visible Slack composer without sending. Supply exactly one of text or Quill insert ops. Existing file attachments remain attached. Open the destination channel/thread first.',
    'set_draft',
    {
      target: composer,
      text: z.string().max(100000).optional(),
      ops: z
        .array(z.object({ insert: z.union([z.string(), object]), attributes: object.optional() }).strict())
        .max(2000)
        .optional(),
      append: z.boolean().default(false),
    },
    false,
  );
  add(
    'slack_get_saved_items',
    'List Later saved items, to-dos, completed items, or archived items. Returns references/metadata rather than hydrating message content; use message tools to read a referenced message.',
    {
      filter: z.enum(['saved', 'todo', 'completed', 'archived']).default('saved'),
      limit: z.number().int().min(1).max(50).default(20),
      cursor: z.string().optional(),
      include_content: z.boolean().default(true),
    },
    true,
    async (args, signal) => {
      const { include_content, ...params } = args;
      const response = (await api('saved.list', params, signal)) as Record<string, any>;
      return include_content
        ? response
        : {
            ...response,
            saved_items: response.saved_items?.map((item: any) => ({
              item_id: item.item_id,
              item_type: item.item_type,
              ts: item.ts,
              state: item.state,
              todo_state: item.todo_state,
              date_due: item.date_due,
              is_archived: item.is_archived,
            })),
          };
    },
  );
  add(
    'slack_save_message',
    'Save a message to your Later list, optionally as a to-do with a reminder time in Unix seconds.',
    { channel: text, ts, as_todo: z.boolean().default(false), due_at: z.number().int().positive().optional() },
    false,
    (args, signal) =>
      api(
        'saved.add',
        {
          window_id: args.window_id,
          item_type: 'message',
          item_id: args.channel,
          ts: args.ts,
          todo_state: args.as_todo || args.due_at ? 'to_do' : 'saved',
          ...(args.due_at ? { date_due: args.due_at } : {}),
        },
        signal,
      ),
  );
  add(
    'slack_remove_saved_message',
    'Remove a specific saved message from your Later list. Does not delete the Slack message.',
    { channel: text, ts },
    false,
    (args, signal) =>
      api(
        'saved.delete',
        { window_id: args.window_id, item_type: 'message', item_id: args.channel, ts: args.ts },
        signal,
      ),
  );
  feature(
    'slack_resolve_link',
    'Resolve a Slack channel/message/thread/profile URL into exact IDs, timestamps, and a usable deep link. Does not navigate or fetch message content.',
    'resolve_link',
    { url: text },
    true,
  );
  feature(
    'slack_download_file',
    'Download a Slack file’s actual bytes to an absolute local path (up to 64 MiB). Uses the selected window’s login. Existing local files are never overwritten.',
    'download_file',
    { file: text, destination: localPath },
    false,
  );
  feature(
    'slack_upload_file',
    'Upload a local regular file (up to 64 MiB) in one call. Takes an absolute path. Supply channel to share immediately, optionally thread_ts and initial_comment; omit channel to keep it private to yourself.',
    'upload_file',
    {
      path: localPath,
      title: text.optional(),
      channel: text.optional(),
      thread_ts: ts.optional(),
      initial_comment: z.string().optional(),
    },
    false,
  );
  add(
    'slack_set_status',
    'Set or clear your Slack status. emoji uses :name: syntax; expires_at is Unix seconds, or 0 for no expiry.',
    { text: z.string().max(100), emoji: z.string().default(''), expires_at: z.number().int().nonnegative().default(0) },
    false,
    (args, signal) =>
      api(
        'users.profile.set',
        {
          window_id: args.window_id,
          profile: { status_text: args.text, status_emoji: args.emoji, status_expiration: args.expires_at },
        },
        signal,
      ),
  );
  add(
    'slack_set_dnd',
    'Pause notifications for a number of minutes. Pass 0 to end your current snooze period.',
    { minutes: z.number().int().min(0).max(1440) },
    false,
    (args, signal) =>
      api(
        args.minutes ? 'dnd.setSnooze' : 'dnd.endSnooze',
        { window_id: args.window_id, ...(args.minutes ? { num_minutes: args.minutes } : {}) },
        signal,
      ),
  );
  feature(
    'slick_list_plugins',
    'List Slick plugin IDs, activation, runtime status, and errors. Filter by ID/name. include_settings additionally returns setting schemas and current values.',
    'list_plugins',
    { query: z.string().default(''), include_settings: z.boolean().default(false) },
    true,
  );
  feature(
    'slick_configure_plugin',
    'Enable/disable a Slick plugin or change validated settings atomically. May restart the plugin; needs_relaunch reports boot-only settings. Changing SlickMCP itself can disconnect this client.',
    'configure_plugin',
    { id: text, enabled: z.boolean().optional(), settings: object.default({}) },
    false,
  );
  feature(
    'slack_screenshot',
    'Capture the selected Slack desktop window as an MCP image. Optionally crop to a CSS selector or current UI element reference. max_width bounds the returned image size.',
    'screenshot',
    { target: text.optional(), max_width: z.number().int().min(200).max(2400).default(1280) },
    true,
  );
  feature(
    'slack_scroll',
    'Scroll a specific UI element reference or CSS selector by CSS pixels. Without target, scrolls the page. Returns actual scroll positions so you can detect the end.',
    'scroll',
    {
      target: text.optional(),
      delta_x: z.number().int().min(-10000).max(10000).default(0),
      delta_y: z.number().int().min(-10000).max(10000).default(500),
    },
    false,
  );
  feature(
    'slack_hover',
    'Move the real mouse over an element reference or CSS selector, opening hover-dependent Slack controls. Does not click.',
    'hover',
    { target: text },
    false,
  );
}
