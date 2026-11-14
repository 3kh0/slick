import { McpServer, type CallToolResult } from '@modelcontextprotocol/server';
import { z } from 'zod';
import { addAdvancedTools } from './advancedTools.ts';
import type { OperationStore } from './operations.ts';
import { addProtocolFeatures } from './protocol.ts';
import { addExtraTools } from './extraTools.ts';

export type OperationScope = { workspace_id: string; user_id: string };
export type AgentBackend = (
  action: string,
  args: Record<string, unknown>,
  signal: AbortSignal,
  scope?: OperationScope,
) => Promise<unknown>;

const text = z.string().min(1);
const timestamp = z.string().regex(/^\d+\.\d+$/);
const channel = text.describe('Slack conversation ID, including public/private channels and DMs.');
const limit = z.number().int().min(1).max(200).default(50);
const cursor = z.string().optional();
const windowId = z
  .number()
  .int()
  .positive()
  .optional()
  .describe('Window ID from slack_get_workspaces. Defaults to the focused Slack window.');
const jsonObject = z.record(z.string(), z.json());

function result(value: unknown): CallToolResult {
  if (
    value &&
    typeof value === 'object' &&
    '__slickImage' in value &&
    value.__slickImage === true &&
    'data' in value &&
    typeof value.data === 'string'
  ) {
    if (value.data.length > 12 * 1024 * 1024) throw new Error('Screenshot is too large; crop it or lower max_width');
    return {
      content: [{ type: 'image', data: value.data, mimeType: 'image/png' }],
      structuredContent: { data: { mime_type: 'image/png' } },
    };
  }
  const encoded = JSON.stringify(value ?? null, null, 2);
  if (Buffer.byteLength(encoded) > 1024 * 1024)
    throw new Error('Result exceeds 1 MiB. Use a smaller limit or select fewer fields.');
  return { content: [{ type: 'text', text: encoded }], structuredContent: { data: value ?? null } };
}

export async function createAgentServer(backend: AgentBackend, operations?: OperationStore): Promise<McpServer> {
  const server = new McpServer(
    { name: 'Slick MCP', version: '1.0.0' },
    {
      cacheHints: {
        'tools/list': { ttlMs: 300000, cacheScope: 'private' },
        'prompts/list': { ttlMs: 300000, cacheScope: 'private' },
        'resources/read': { ttlMs: 0, cacheScope: 'private' },
      },
      instructions:
        'Slack access through the local Slick desktop app, as the signed-in user. Start with slack_get_workspaces and pass window_id when multiple workspaces are open. Use focused Slack tools first; slack_api covers other Slack methods and slack_evaluate covers desktop UI. Read tools return Slack IDs, timestamps, and pagination cursors. Supply a unique operation_id on writes and reuse it with identical arguments after a lost response. Check slick_get_operation for running or unknown outcomes; these are never automatically re-executed. Receipts contain IDs, not original output. Event subscriptions have explicit handles and replay cursors.',
    },
  );
  const add = (
    name: string,
    description: string,
    shape: z.ZodRawShape,
    readOnly: boolean,
    run: (args: Record<string, any>, signal: AbortSignal) => Promise<unknown>,
  ) =>
    server.registerTool(
      name,
      {
        description,
        inputSchema: z
          .object({
            window_id: windowId,
            ...shape,
            ...(!readOnly
              ? {
                  operation_id: z
                    .string()
                    .regex(/^[A-Za-z0-9_-]{8,128}$/)
                    .optional()
                    .describe(
                      'Unique retry key. Reuse with identical arguments to avoid duplicate writes. Retained across app restarts.',
                    ),
                }
              : {}),
          })
          .strict(),
        outputSchema: z.object({ data: z.unknown().optional() }),
        annotations: {
          readOnlyHint: readOnly,
          destructiveHint: !readOnly,
          idempotentHint: readOnly,
          openWorldHint: true,
        },
      },
      async (args, context) => {
        const progressToken = context.mcpReq._meta?.progressToken;
        let progress = 0;
        const notify = async (message: string) => {
          if (progressToken !== undefined && !context.mcpReq.signal.aborted)
            await context.mcpReq
              .notify({ method: 'notifications/progress', params: { progressToken, progress: ++progress, message } })
              .catch(() => {});
        };
        await notify('Starting');
        const timer =
          progressToken === undefined
            ? undefined
            : setInterval(() => {
                void notify('Working');
              }, 5000);
        timer?.unref();
        try {
          const { operation_id, ...writeParams } = args;
          const params = readOnly ? args : writeParams;
          const signal = context.mcpReq.signal;
          if (readOnly || !operations) return result(await run(params, signal));
          const windows = (await backend('workspaces', { window_id: params.window_id }, signal)) as any[];
          const selected = windows.find((entry) => entry.focused) ?? windows[0];
          if (!selected?.ready || !selected.workspace_id || !selected.user_id)
            throw new Error('A signed-in workspace is required for writes');
          return result(
            await operations.run(
              operation_id as string | undefined,
              name,
              { ...params, window_id: undefined },
              { workspace_id: selected.workspace_id, user_id: selected.user_id },
              () =>
                run(
                  {
                    ...params,
                    window_id: selected.window_id,
                    __scope: { workspace_id: selected.workspace_id, user_id: selected.user_id },
                  },
                  signal,
                ),
            ),
          );
        } catch (error) {
          return {
            isError: true,
            content: [{ type: 'text', text: error instanceof Error ? error.message : String(error) }],
          };
        } finally {
          clearInterval(timer);
          await notify('Finished');
        }
      },
    );
  const api = (method: string, args: Record<string, unknown>, signal: AbortSignal) => {
    const { window_id, __scope, ...params } = args;
    return backend('api', { window_id, __scope, method, params }, signal);
  };
  const mapped = (name: string, description: string, method: string, shape: z.ZodRawShape, readOnly = true) =>
    add(name, description, shape, readOnly, (args, signal) => api(method, args, signal));

  add(
    'slack_get_workspaces',
    'List open Slack windows, their active workspace, and signed-in workspace IDs. No credentials are returned.',
    {},
    true,
    (args, signal) => backend('workspaces', args, signal),
  );
  mapped(
    'slack_search_messages',
    'Search messages using Slack syntax: in:channel, from:user, before:, after:, and quoted phrases. Returns matches with timestamps and permalinks. Paginate with page.',
    'search.messages',
    {
      query: text,
      count: z.number().int().min(1).max(100).default(20),
      page: z.number().int().positive().default(1),
      sort: z.enum(['timestamp', 'score']).default('timestamp'),
      sort_dir: z.enum(['asc', 'desc']).default('desc'),
    },
  );
  mapped(
    'slack_search_files',
    'Search Slack files using Slack search syntax. Returns file metadata and pagination.',
    'search.files',
    { query: text, count: z.number().int().min(1).max(100).default(20), page: z.number().int().positive().default(1) },
  );
  mapped(
    'slack_read_channel',
    'Read a page of conversation history. Follow response_metadata.next_cursor for older messages; use slack_read_thread for replies.',
    'conversations.history',
    {
      channel,
      limit,
      cursor,
      oldest: timestamp.optional(),
      latest: timestamp.optional(),
      inclusive: z.boolean().default(false),
    },
  );
  mapped(
    'slack_read_thread',
    'Read a thread by its root message timestamp. Includes the root and replies, with a next_cursor when more are available.',
    'conversations.replies',
    { channel, ts: timestamp, limit, cursor },
  );
  mapped(
    'slack_list_channels',
    'List visible conversations, including DMs. Use the returned next_cursor to continue.',
    'conversations.list',
    {
      types: z.string().default('public_channel,private_channel,mpim,im'),
      exclude_archived: z.boolean().default(true),
      limit,
      cursor,
    },
  );
  mapped(
    'slack_get_channel_info',
    'Get a channel or DM’s details, topic, purpose, and membership information.',
    'conversations.info',
    { channel },
  );
  mapped('slack_get_channel_members', 'List channel member IDs, with cursor pagination.', 'conversations.members', {
    channel,
    limit,
    cursor,
  });
  add(
    'slack_search_users',
    'Find people by name, ID, or email within a page of the workspace directory. Follow next_cursor even when this page has no matches.',
    { query: text, limit, cursor },
    true,
    async (args, signal) => {
      const { query, ...params } = args;
      const response = (await api('users.list', params, signal)) as Record<string, any>;
      const needle = query.toLowerCase();
      return {
        ...response,
        members: response.members?.filter((user: any) =>
          [
            user.id,
            user.name,
            user.real_name,
            user.profile?.display_name,
            user.profile?.real_name,
            user.profile?.email,
          ].some((value) => typeof value === 'string' && value.toLowerCase().includes(needle)),
        ),
      };
    },
  );
  add(
    'slack_search_channels',
    'Find channels by name, topic, or purpose within one page of visible conversations. Follow next_cursor even when this page has no matches.',
    { query: text, limit, cursor },
    true,
    async (args, signal) => {
      const { query, ...params } = args;
      const response = (await api(
        'conversations.list',
        { ...params, types: 'public_channel,private_channel', exclude_archived: true },
        signal,
      )) as Record<string, any>;
      const needle = query.toLowerCase();
      return {
        ...response,
        channels: response.channels?.filter((entry: any) =>
          [entry.id, entry.name, entry.topic?.value, entry.purpose?.value].some(
            (value) => typeof value === 'string' && value.toLowerCase().includes(needle),
          ),
        ),
      };
    },
  );
  mapped('slack_get_user_profile', 'Read a user’s profile, including status and custom profile fields.', 'users.info', {
    user: text,
  });
  mapped('slack_search_emoji', 'List custom workspace emoji and aliases.', 'emoji.list', {});
  mapped(
    'slack_read_file',
    'Read Slack file metadata, including private download URLs accessible to this signed-in account.',
    'files.info',
    { file: text },
  );
  mapped(
    'slack_send_message',
    'Send a message as the signed-in user. Supports Slack mrkdwn; supply thread_ts to reply in a thread. This posts immediately.',
    'chat.postMessage',
    {
      channel,
      text,
      thread_ts: timestamp.optional(),
      unfurl_links: z.boolean().default(false),
      unfurl_media: z.boolean().default(false),
    },
    false,
  );
  mapped(
    'slack_schedule_message',
    'Schedule a message for a future Unix timestamp in seconds.',
    'chat.scheduleMessage',
    { channel, text, post_at: z.number().int().positive(), thread_ts: timestamp.optional() },
    false,
  );
  mapped(
    'slack_edit_message',
    'Replace the text of one of your messages.',
    'chat.update',
    { channel, ts: timestamp, text },
    false,
  );
  mapped(
    'slack_delete_message',
    'Permanently delete one of your messages.',
    'chat.delete',
    { channel, ts: timestamp },
    false,
  );
  mapped(
    'slack_add_reaction',
    'Add an emoji reaction as yourself. Use the emoji name without surrounding colons.',
    'reactions.add',
    { channel, timestamp, name: text },
    false,
  );
  mapped(
    'slack_remove_reaction',
    'Remove your emoji reaction from a message.',
    'reactions.remove',
    { channel, timestamp, name: text },
    false,
  );
  mapped('slack_get_reactions', 'Read the reactions on a message.', 'reactions.get', { channel, timestamp });
  mapped(
    'slack_open_conversation',
    'Open a DM or group DM with a comma-separated list of user IDs.',
    'conversations.open',
    { users: text },
    false,
  );
  mapped(
    'slack_create_channel',
    'Create a public or private channel.',
    'conversations.create',
    { name: text, is_private: z.boolean().default(false) },
    false,
  );
  mapped(
    'slack_get_file_upload_url',
    'Start an external file upload. POST the file bytes to upload_url, then call slack_complete_file_upload. length is the byte count.',
    'files.getUploadURLExternal',
    { filename: text, length: z.number().int().positive() },
    false,
  );
  mapped(
    'slack_complete_file_upload',
    'Finalize an upload. Set channel_id to share it; without a channel it remains private to you.',
    'files.completeUploadExternal',
    {
      files: z.array(z.object({ id: text, title: z.string().optional() })).min(1),
      channel_id: text.optional(),
      initial_comment: z.string().optional(),
      thread_ts: timestamp.optional(),
    },
    false,
  );
  mapped(
    'slack_create_canvas',
    'Create a canvas from markdown. Further canvas and list operations are available through slack_api.',
    'canvases.create',
    { title: text, document_content: z.object({ type: z.literal('markdown'), markdown: text }) },
    false,
  );
  mapped(
    'slack_update_canvas',
    'Apply Slack canvas operations such as document replacement or section edits.',
    'canvases.edit',
    { canvas_id: text, changes: z.array(jsonObject).min(1) },
    false,
  );

  add(
    'slack_api',
    'Call any Slack Web API method as yourself, including methods not covered by focused tools (canvases, lists, pins, bookmarks, statuses, preferences). Params are JSON values; arrays and objects are encoded as JSON. This may change workspace data.',
    { method: z.string().regex(/^[A-Za-z][A-Za-z0-9]*(?:\.[A-Za-z][A-Za-z0-9]*)+$/), params: jsonObject.default({}) },
    false,
    (args, signal) => backend('api', args, signal),
  );
  add(
    'slack_read_ui',
    'Read the visible desktop UI and interactive element references. References are scoped to the selected window and remain valid until its next snapshot. Use selector to scope the snapshot.',
    { selector: z.string().default('body'), limit: z.number().int().min(1).max(500).default(100) },
    true,
    (args, signal) => backend('read_ui', args, signal),
  );
  add(
    'slack_click',
    'Click an element reference from slack_read_ui, or a CSS selector. Can perform outward actions such as sending, joining, or deleting.',
    { target: text },
    false,
    (args, signal) => backend('click', args, signal),
  );
  add(
    'slack_type',
    'Replace or append text in a text field or Slack composer. Uses Quill for Slack’s rich-text editors; does not press Enter or send.',
    { target: text, text: z.string(), append: z.boolean().default(false) },
    false,
    (args, signal) => backend('type', args, signal),
  );
  add(
    'slack_keypress',
    'Press an Electron keyboard key in the selected Slack window. key uses Electron keyCode names (Enter, Escape, Tab, Left, etc.); modifiers may include control, shift, alt, meta. Enter can send a message.',
    { key: text, modifiers: z.array(z.enum(['control', 'shift', 'alt', 'meta'])).default([]) },
    false,
    (args, signal) => backend('keypress', args, signal),
  );
  add(
    'slack_open',
    'Open a Slack deep link in the selected window, including channels, threads, profiles, or another signed-in workspace.',
    { uri: z.string().startsWith('slack://') },
    false,
    (args, signal) => backend('open', args, signal),
  );
  add(
    'slack_find_actions',
    'Find Slack’s named Redux actions by case-insensitive substring. Use slack_dispatch_action to invoke one. These are Slack-private APIs and can change.',
    { query: text },
    true,
    (args, signal) => backend('find_actions', args, signal),
  );
  add(
    'slack_dispatch_action',
    'Invoke a named Slack Redux thunk with a JSON argument. Can perform any action available to the signed-in user.',
    { name: text, args: z.json().optional() },
    false,
    (args, signal) => backend('dispatch_action', args, signal),
  );
  add(
    'slack_evaluate',
    'Run an async JavaScript function body in the selected Slack page for advanced UI work. Locals: api (Slick API), redux, document, window. Return a JSON-serializable value. Runs with full page access and can perform outward actions.',
    { code: text.max(64 * 1024) },
    false,
    (args, signal) => backend('evaluate', args, signal),
  );
  addExtraTools(add, api, backend);
  addAdvancedTools(add, api, backend);
  if (operations)
    add(
      'slick_get_operation',
      'Check one durable write receipt by its exact operation_id. No agent history or message bodies are stored. Unknown outcomes must be reconciled in Slack before another write.',
      { operation_id: text },
      true,
      async (args) => operations.get(args.operation_id),
    );
  await addProtocolFeatures(server, backend);
  return server;
}
