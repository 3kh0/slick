# Slick MCP

Desktop-only, opt-in access to Slack for local agents. Enable **Slick MCP** in Preferences → Plugins, then open the **Slick MCP** preferences tab and copy a connection configuration into your MCP client. Keep Slick running while connected.

**Copy JSON configuration** provides an HTTP MCP entry for clients using `mcpServers`. **Copy Codex configuration** provides a TOML entry for Codex's configuration file. Both contain the local connection token, so treat the copied configuration as a credential. The endpoint defaults to `http://127.0.0.1:38465/mcp`; change the port in plugin settings if another app uses it. Reconnect the client after changing the port or regenerating the token.

The server binds only to IPv4 loopback, requires a bearer token, checks the Host header, and rejects browser Origin headers. It uses the official MCP SDK's Streamable HTTP transport, with support for both current and 2025 clients. The connection token persists in Slick's private secret store. Disabling the plugin closes the server; regenerating the token revokes the old configuration. This is a local bridge, not Slack's hosted MCP service, and it does not require a separate Slack app or copy Slack login credentials into your agent configuration.

2025 clients receive isolated MCP sessions so cancellation targets the correct request and client. Up to 64 sessions are supported; sessions idle for an hour expire and require reconnecting. Current-protocol requests use the SDK's per-request handler.

Connected agents have your Slack access, including private conversations and outward actions. Tools can send or delete messages, create channels, modify settings, and use the UI. Only connect clients you trust. Existing Slack permissions and rate limits still apply. A timeout is not proof that an action failed: check Slack before retrying a write.

## Tool access and message attribution

Use **Exposed tools** on the plugin detail page or the Slick MCP tab to search the full tool catalog and enable individual tools. **All**, **Read-only**, and **None** are shortcuts; save your selection to apply it across every workspace and connected agent. Saving restarts the local server without changing its token. Reconnect clients that cache the catalog. Disabled tools are absent from discovery and rejected if a client tries a cached tool name. Once you customize access, tools added by future Slick updates stay off until you enable them.

API, JavaScript, and desktop controls are broad tools that can perform actions covered by other tools. Turn them off too when restricting actions. These controls select MCP tools, not individual Slack API methods or page capabilities. Read-only resources remain available independently of tool selection.

**Attribute agent messages** is on by default. Message posts, replies, scheduled messages, edits, and shared file comments sent through the MCP message/API tools include a small linked **Sent via SlickMCP** context footer. Existing blocks and file contents are preserved. Private file uploads are unchanged. Arbitrary page JavaScript, Redux actions, and UI interactions do not pass through the message API formatter.

## Tools

The focused tools take inspiration from [Slack's official MCP server](https://docs.slack.dev/ai/slack-mcp-server/):

- Discover open windows and signed-in workspaces with `slack_get_workspaces`.
- Search messages/files and browse channels, users, custom emoji, and profiles.
- Read channel history, threads, channel members, files, and reactions.
- Send, schedule, edit, or delete your messages; add/remove your reactions.
- Open DMs and group DMs, create channels and canvases, edit canvases, and perform two-step file uploads.

Use the returned cursors/page numbers to paginate. User/channel search filters each returned directory page by name, ID, or profile/topic fields; follow the next cursor even when a page has no matches. `slack_read_file` returns metadata; `slack_download_file` downloads the actual file bytes.

`slack_api` covers additional Web API methods, including lists, bookmarks, pins, and profile updates. Its JSON parameters are encoded for Slack's API. `slack_find_actions` and `slack_dispatch_action` expose Slack's named Redux thunks; these are Slack-private contracts and may change.

`slack_read_ui`, `slack_click`, `slack_type`, and `slack_keypress` operate on the actual desktop page. UI snapshots include visible text and window-scoped element references; take a fresh snapshot after navigation. Typing into Slack's composer uses Quill and does not send until a separate action presses Enter or clicks Send. `slack_evaluate` accepts an async JavaScript function body with `api`, `redux`, `document`, and `window` in scope for advanced operations. It has full page access, not Node or Electron main-process access.

Pass `window_id` from workspace discovery when multiple Slack windows are open; otherwise tools use the focused Slack window, falling back to the first client. Only workspaces currently open in a Slack window can receive API calls. Use `slack_open` with a Slack deep link to switch the selected window to another signed-in workspace.

## Catch-up, drafts, and events

- `slack_get_unreads` returns fresh unread conversation IDs, read markers, and mention counts, with `next_offset` pagination. `slack_mark_read` advances your read marker through an explicit timestamp.
- `slack_get_activity` reads mentions, replies, DMs, and reactions. `slack_get_saved_items` reads Later (saved, to-do, completed, or archived). Both support `include_content: false` for metadata-only inspection and retain pagination cursors. Saving and removing Later messages have dedicated tools.
- `slack_get_draft` reads a visible composer’s text and rich Quill ops; `slack_set_draft` replaces or appends text or insert ops without sending. Open the destination conversation first. The default selector targets a channel composer; pass `target` to choose a thread composer. Draft changes use Slack’s normal user-edit path and can sync across your devices; they are not isolated scratch storage. Clearing text leaves separately attached files attached.
- `slack_resolve_link` resolves channel, message, thread, and profile links into IDs and a Slack deep link, preserving full timestamp precision, without navigating or reading the linked content.
- `slack_wait_for_event` waits for future websocket events. Type, channel, author, thread, and timestamp filters are ANDed. Waits last up to 25 seconds; a timeout returns `timed_out: true`. Repeat the wait to keep watching. For replay between calls, use the resumable event buffers below. Cancellation, plugin stop, and timeout remove the subscription; each window supports up to 32 concurrent waits. Set `include_content: false` for metadata-only events.

Activity, Later, and unread counts use interfaces observed in Slack’s current desktop client; these are private contracts and may change with Slack updates.

## Files and desktop controls

`slack_download_file` writes to an absolute local path and never overwrites an existing file. `slack_upload_file` reads an absolute local regular-file path and performs all upload steps. Both are limited to 64 MiB; transfers may need a longer client timeout (up to two minutes). Uploads stay private unless `channel` is provided; a thread or initial comment requires a channel. Uploading and sharing are real Slack actions. Downloads use the selected window’s cookie session and token, with credentials stripped from external redirects. Partial failed downloads are removed.

`slack_set_status` sets or clears a status with optional expiry. `slack_set_dnd` pauses notifications for the requested minutes; `0` ends snooze.

`slack_screenshot` returns an MCP image, optionally cropped to an element reference or selector and scaled by `max_width`. `slack_hover` moves the real pointer to an element. `slack_scroll` scrolls the selected element’s nearest scrollable container (or the page) and returns its actual position. Native clicks, hover, and keyboard actions can bring Slack to the foreground.

`slick_list_plugins` lists plugin activation and runtime errors, with optional schemas/settings. `slick_configure_plugin` validates and saves a whole setting update atomically, optionally enabling/disabling the plugin. It reports boot-only settings requiring relaunch. Changes to SlickMCP itself can disconnect your agent.

## Context, channel management, and Lists

`slack_get_message_context` accepts a permalink or `channel` + `ts`, reads the exact message and its thread, and resolves author names. Nearby history is bounded: newer history scans at most five pages of 100 messages; if it cannot reach the message, `after_truncated` is true and `after` is empty rather than presenting distant messages as neighbors. Thread cursors remain available in the response.

`slack_resolve_person` accepts IDs, mentions, emails, profile links, and names. `slack_resolve_channel` accepts IDs, mentions, channel links, and names. Name resolution scans up to ten directory pages per call, preserves ambiguous matches, and reports `complete` and `next_cursor`. Continue incomplete scans before treating a name as unique.

Dedicated tools list/cancel scheduled messages; join/leave/invite/rename channels and edit topics/purposes; list/add/remove pins; list/add/edit/remove bookmarks; and read canvas Markdown or HTML through `canvases.getContent`. Canvas reads report truncation. Slack List tools list/read/create/delete records and update up to 100 cells using Slack's column/row IDs and typed values. Workspace permissions and plan restrictions still apply.

## Retry receipts

Every write tool accepts an optional `operation_id`. Generate one **before** calling a write and retain it across connection failures. Reusing the same ID with the same tool, arguments, user, and workspace returns its receipt without executing again. Reusing it for different arguments or another workspace is rejected. Writes without an ID receive a generated UUID in their result, but a lost response can lose that UUID too.

`slick_get_operation` looks up one exact ID. `running` means the original call has not finished; `completed` includes available Slack result IDs; `unknown` means a timeout, failure, or restart prevented a definite result. Check Slack to reconcile unknown writes; changing the ID can duplicate an action. Cancellation cannot undo a write already submitted to Slack. `not_found` only means this Slick profile has no receipt for that ID, not proof that Slack did nothing.

Receipts are persisted before dispatch in Slick's local plugin storage and survive server/app restarts. Pending receipts become unknown on restart. They store a SHA-256 argument/scope fingerprint, tool name, timestamps, status, and selected result IDs. They do not retain message bodies, original arguments, full results, or agent history. Replays return receipts, not the original output. Receipts are retained indefinitely, with a hard cap of 1000; the server refuses additional writes at the cap rather than evicting retry protection. Clearing SlickMCP storage removes that protection and should only happen after reconciling outstanding operations.

## Resumable event buffers

`slack_subscribe_events` creates a window-scoped explicit handle and cursor. `slack_poll_events` returns events after that cursor without consuming them; retrying a cursor replays the same retained events. Keep the returned cursor for the next poll, and call `slack_unsubscribe_events` when finished. Each window supports 16 buffers with 200 events each, a 30-minute idle lifetime, and 16 KiB per-event content bounds. Metadata-only delivery is the default. `gap: true` reports overflow and requires refreshing Slack state. Buffers do not survive renderer restarts; they cover events received after subscription, not websocket outages or historical events.

## MCP protocol support

The official TypeScript SDK serves revision **2026-07-28** alongside **2025-11-25** clients. Modern clients use stateless requests, `server/discover`, per-request capabilities, standard Streamable HTTP routing, and `resultType` envelopes. Older clients retain isolated sessions and cancellation. All tool listings are deterministic; tool annotations describe reads and potentially destructive actions. JSON results also expose `structuredContent.data` and an output schema; screenshots remain native MCP image content. Progress is sent only when a client requests it, and stops when the request finishes.

Private cache hints allow caching static tool/prompt catalogs for five minutes; live workspace resources are never cached. Read `slick://workspaces` or the `slick://windows/{window_id}/context` resource template. Resource-template window IDs and prompt detail arguments support completion. The prompts `catch-up`, `prepare-reply`, and `channel-brief` provide reusable workflows. Clients supporting the official **Skills over MCP** extension can discover the `slick-workflows` skill and read its workflow instructions as resources; other clients continue using the same tools and prompts.

MCP Tasks, MCP Apps, and multi-round-trip elicitation are separate optional features, not required for the current bounded tools. Slick does not advertise them. Operation receipts are retry protection, not a claim of Tasks-extension support. Event buffers use explicit tool handles; they are not protocol SSE replay, which the modern spec removed.
