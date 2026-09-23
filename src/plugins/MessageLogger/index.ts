// Listens at the RTM router, puts deleted messages back through
// injectMessages (messages + channelHistory), and styles rows via a component
// patch.

import { SlickPlugin, type ComponentType, type RtmEvent, type SlackMessage } from '$slick';
import * as meta from './meta.ts';
import { MAX_EDIT_TEXT, MAX_EDITS_PER_MESSAGE, evictable, normalize, trim } from './retention.ts';

type StoredEdit = { oldText: string; newText: string };

type LogEntry = {
  channel: string;
  ts: string;
  user?: string;
  deleted?: boolean;
  message?: SlackMessage;
  edits?: StoredEdit[];
  at: number;
};

type RowProps = {
  msg?: SlackMessage;
  message?: SlackMessage;
  channelId?: string;
  className?: string;
};

type ActionsMenuProps = {
  channelId?: string;
  ts?: string;
  onTriggerClose?: (event?: unknown) => void;
};

type MenuProps = { children?: React.ReactNode };

/** Old single-blob layout; migrated to per-entry keys on load. */
const LEGACY_STORAGE_KEY = 'log';
const ENTRY_PREFIX = 'entry:';
const RECENT_CAP = 400;
const ROW_COMPONENTS = ['MessageWrapper', 'ThreadRootGeneric'] as const;

function decode(value: string): string {
  return value
    .replace(/<([^>|]+)\|([^>]+)>/g, '$2')
    .replace(/<([^>]+)>/g, '$1')
    .trim();
}

function messageText(msg: SlackMessage | undefined): string {
  if (!msg) return '';
  return typeof msg.text === 'string' ? decode(msg.text) : '';
}

function channelOf(event: RtmEvent, msg?: SlackMessage): string {
  if (typeof msg?.channel === 'string' && msg.channel) return msg.channel;
  if (typeof event.channel === 'string' && event.channel) return event.channel;
  if (typeof event.channel_id === 'string' && event.channel_id) return event.channel_id;
  return '';
}

function tsOf(event: RtmEvent, msg?: SlackMessage): string {
  if (typeof event.deleted_ts === 'string' && event.deleted_ts) return event.deleted_ts;
  if (typeof msg?.ts === 'string' && msg.ts) return msg.ts;
  if (typeof event.ts === 'string' && event.ts) return event.ts;
  return '';
}

function userOf(msg?: SlackMessage, event?: RtmEvent): string {
  if (typeof msg?.user === 'string' && msg.user) return msg.user;
  if (typeof event?.user === 'string' && event.user) return event.user;
  return '';
}

function isDeleteEvent(event: RtmEvent): boolean {
  const message = event.message as SlackMessage | undefined;
  return event.type === 'message_deleted' || event.subtype === 'message_deleted' || message?.subtype === 'tombstone';
}

function isChangeEvent(event: RtmEvent): boolean {
  return event.type === 'message_changed' || event.subtype === 'message_changed';
}

function asInjected(previous: SlackMessage, channel: string, ts: string): SlackMessage {
  const message: SlackMessage = { ...previous, channel, ts };
  if (message.subtype === 'tombstone' || message.subtype === 'message_deleted') delete message.subtype;
  delete message.hidden;
  return trim(message);
}

export default class MessageLogger extends SlickPlugin<typeof meta.settings> {
  static readonly id = meta.id;
  static readonly pluginName = meta.pluginName;
  static readonly description = meta.description;
  static readonly defaultEnabled = meta.defaultEnabled;
  static readonly settings = meta.settings;
  static readonly liveSettings = ['deletedStyle', 'retentionDays'];

  private readonly entries = new Map<string, LogEntry>();
  private readonly recent = new Map<string, SlackMessage>();
  private readonly dirty = new Set<string>();
  private writes: Promise<void> = Promise.resolve();
  private persistTimer: ReturnType<typeof setTimeout> | null = null;
  private rowTimer: ReturnType<typeof setTimeout> | null = null;
  private seenRow = false;

  /** `MessageActionsMenu` knows the message; the generic `Menu` that renders rows does not. */
  private readonly MenuRowsContext = React.createContext<React.ReactNode[]>([]);

  async start() {
    await this.restore();
    if (this.api.signal.aborted) return;
    this.cap();
    this.flush();

    this.api.rtm.on('message', (event) => {
      if (isDeleteEvent(event) || isChangeEvent(event)) return;
      this.remember(event);
    });
    this.api.rtm.on('message_deleted', (event) => this.record(event));
    this.api.rtm.on('message_changed', (event) => this.record(event));

    this.api.messages.injectMessages(() => this.injectable());
    this.api.setStyle(this.css(), 'deleted');
    this.patchRows();
    this.patchMenu();
    this.log(`logging deletes and edits (${this.entries.size} stored)`);
  }

  onSettingsChange() {
    this.api.setStyle(this.css(), 'deleted');
    // Apply lowered retention now, not at the next delete.
    if (this.cap()) this.flush();
    this.api.redux.refresh();
  }

  stop() {
    if (this.rowTimer) clearTimeout(this.rowTimer);
    this.rowTimer = null;
    this.flush();
  }

  private accept(key: string, entry: LogEntry | null | undefined): boolean {
    if (!entry || typeof entry !== 'object') return false;
    if (typeof entry.channel !== 'string' || typeof entry.ts !== 'string') return false;
    if (normalize(entry)) this.dirty.add(key);
    this.entries.set(key, entry);
    return true;
  }

  /** One key per entry so a delete doesn't rewrite the whole log (the blob reached 881 KB). */
  private async restore() {
    const stored = await this.api.storage.entries<LogEntry>(ENTRY_PREFIX);
    for (const [key, entry] of stored) this.accept(key.slice(ENTRY_PREFIX.length), entry);

    const legacy = await this.api.storage.get<Record<string, LogEntry> | null>(LEGACY_STORAGE_KEY, null);
    if (!legacy || typeof legacy !== 'object') return;
    let migrated = 0;
    for (const [key, entry] of Object.entries(legacy)) {
      // A per-entry copy is newer.
      if (this.entries.has(key)) continue;
      if (!this.accept(key, entry)) continue;
      this.dirty.add(key);
      migrated++;
    }
    await this.api.storage.delete(LEGACY_STORAGE_KEY);
    this.log(`migrated ${migrated} entries out of the single-blob log`);
  }

  private key(channel: string, ts: string) {
    return `${channel}:${ts}`;
  }

  private remember(event: RtmEvent) {
    const channel = channelOf(event, event as SlackMessage);
    const ts = tsOf(event, event as SlackMessage);
    if (!channel || !ts) return;
    this.recent.set(this.key(channel, ts), { ...(event as SlackMessage), channel, ts });
    while (this.recent.size > RECENT_CAP) {
      const first = this.recent.keys().next().value;
      if (first === undefined) break;
      this.recent.delete(first);
    }
  }

  private record(event: RtmEvent) {
    if (isDeleteEvent(event)) this.recordDelete(event);
    else if (isChangeEvent(event)) this.recordEdit(event);
  }

  private previousOf(event: RtmEvent): SlackMessage | undefined {
    const previous = (event.previous_message ?? event.previous) as SlackMessage | undefined;
    if (previous && typeof previous === 'object') return previous;
    return undefined;
  }

  private original(event: RtmEvent, channel: string, ts: string): SlackMessage | undefined {
    return (
      this.previousOf(event) ?? this.recent.get(this.key(channel, ts)) ?? this.api.messages.getRawMessage(channel, ts)
    );
  }

  private currentUserId(): string | undefined {
    const id = this.api.redux.getRawState()?.bootData?.user_id;
    return typeof id === 'string' ? id : undefined;
  }

  private skipSelf(user: string | undefined): boolean {
    if (!this.config.ignoreSelf || !user) return false;
    const me = this.currentUserId();
    return !!me && me === user;
  }

  private skipAnchor(msg: SlackMessage | undefined): boolean {
    if (!msg) return false;
    switch (this.config.ignoreAnchors) {
      case 'lax':
        return !!msg.app_id;
      case 'strict':
        return (msg.metadata as { event_type?: string } | undefined)?.event_type === 'anchor' && !!msg.app_id;
      default:
        return false;
    }
  }

  private recordDelete(event: RtmEvent) {
    const previous = this.previousOf(event);
    const channel = channelOf(event, previous);
    const ts = tsOf(event, previous);
    if (!channel || !ts) return;
    const original = this.original(event, channel, ts);
    const user = userOf(original ?? previous, event);
    if (this.skipAnchor(original ?? previous)) return;
    if (this.skipSelf(user)) return;

    const key = this.key(channel, ts);
    const existing = this.entries.get(key);
    if (existing?.deleted) return;

    const message = original ? asInjected(original, channel, ts) : undefined;
    const entry: LogEntry = {
      ...(existing ?? { channel, ts, at: Date.now() }),
      channel,
      ts,
      user: existing?.user || user,
      deleted: true,
      message: message ?? existing?.message,
      at: Date.now(),
    };
    this.entries.set(key, entry);
    this.dirty.add(key);
    this.cap();
    this.persist();
    this.api.redux.refresh();
  }

  private recordEdit(event: RtmEvent) {
    if (isDeleteEvent(event)) {
      this.recordDelete(event);
      return;
    }
    const previous = this.previousOf(event);
    const next = event.message as SlackMessage | undefined;
    const channel = channelOf(event, next ?? previous);
    const ts = tsOf(event, next ?? previous);
    if (!channel || !ts) return;
    const original = this.original(event, channel, ts);
    const user = userOf(next ?? original ?? previous, event);
    if (this.skipSelf(user)) return;

    const oldText = messageText(previous) || messageText(original);
    const newText = messageText(next);
    if (!oldText || oldText === newText) return;

    const key = this.key(channel, ts);
    const existing = this.entries.get(key);
    const edits = existing?.edits ? [...existing.edits] : [];
    const last = edits[edits.length - 1];
    if (last && last.oldText === oldText && last.newText === newText) return;
    edits.push({ oldText: oldText.slice(0, MAX_EDIT_TEXT), newText: newText.slice(0, MAX_EDIT_TEXT) });
    if (edits.length > MAX_EDITS_PER_MESSAGE) edits.splice(0, edits.length - MAX_EDITS_PER_MESSAGE);

    this.entries.set(key, {
      ...(existing ?? { channel, ts, at: Date.now() }),
      channel,
      ts,
      user: existing?.user || user,
      edits,
      at: existing?.at ?? Date.now(),
    });
    this.dirty.add(key);
    this.cap();
    this.persist();
    this.api.redux.refresh();
  }

  private forget(key: string) {
    this.entries.delete(key);
    this.dirty.add(key);
  }

  /** Returns whether anything was evicted. */
  private cap(): boolean {
    const gone = evictable(this.entries, this.config.retentionDays);
    for (const key of gone) this.forget(key);
    return gone.length > 0;
  }

  private persist() {
    if (this.persistTimer) return;
    this.persistTimer = setTimeout(() => {
      this.persistTimer = null;
      this.flush();
    }, 200);
  }

  private flush() {
    if (this.persistTimer) {
      clearTimeout(this.persistTimer);
      this.persistTimer = null;
    }
    const keys = [...this.dirty];
    this.dirty.clear();
    // Serialised: the migration in restore() can flush hundreds of keys at once.
    for (const key of keys) {
      const entry = this.entries.get(key);
      const storageKey = `${ENTRY_PREFIX}${key}`;
      this.writes = this.writes
        .then(() => (entry ? this.api.storage.set(storageKey, entry) : this.api.storage.delete(storageKey)))
        .then(
          () => {},
          (error) => console.error('[slick] MessageLogger could not persist an entry:', error),
        );
    }
  }

  private injectable(): SlackMessage[] {
    const out: SlackMessage[] = [];
    for (const entry of this.entries.values()) {
      if (!entry.deleted || !entry.message) continue;
      if (typeof entry.message.channel !== 'string' || typeof entry.message.ts !== 'string') continue;
      out.push(entry.message);
    }
    return out;
  }

  private entryFor(msg?: SlackMessage, channelId?: string): LogEntry | undefined {
    const ts = typeof msg?.ts === 'string' ? msg.ts : undefined;
    if (!ts) return;
    const channel = (typeof msg?.channel === 'string' && msg.channel) || channelId;
    if (channel) {
      const hit = this.entries.get(this.key(channel, ts));
      if (hit) return hit;
    }
    let found: LogEntry | undefined;
    for (const entry of this.entries.values()) {
      if (entry.ts !== ts) continue;
      if (channel && entry.channel && entry.channel !== channel) continue;
      if (found) return;
      found = entry;
    }
    return found;
  }

  private css(): string {
    const deleted =
      this.config.deletedStyle === 'opacity'
        ? `.slick-ml-deleted { opacity: 0.5 !important; }`
        : `.slick-ml-deleted, .slick-ml-deleted * { color: #e01e5a !important; }`;
    return `
      ${deleted}
      .slick-ml-edited-original { display: block; padding: 4px 20px 0 64px; opacity: .62; white-space: pre-wrap; word-break: break-word; }
      .slick-ml-edited-original-line { display: block; }
      .slick-ml-edited-original s { text-decoration: line-through; }
      .slick-ml-edited-marker { margin-left: 4px; font-size: .85em; opacity: .72; }
    `;
  }

  private patchRows() {
    for (const name of ROW_COMPONENTS) {
      this.api.patchComponent<RowProps>(name, (Original) => (props) => this.renderRow(Original, props));
    }
    this.rowTimer = setTimeout(() => {
      if (this.api.signal.aborted || this.seenRow) return;
      this.log(
        `${ROW_COMPONENTS.join(' / ')} never rendered; deleted/edited styling may be inert. Dump [...__slickRenderedComponents.keys()]`,
      );
    }, 20_000);
  }

  private renderRow(Original: ComponentType<RowProps>, props: RowProps) {
    const React = this.api.react;
    const version = this.api.redux.usePatchVersion();
    const msg = props.msg ?? props.message;
    const entry = React.useMemo(() => this.entryFor(msg, props.channelId), [msg, props.channelId, version]);
    this.seenRow = true;
    if (!entry?.deleted && !entry?.edits?.length) return React.createElement(Original, props);

    const classes = [props.className, entry.deleted && 'slick-ml-deleted', entry.edits?.length && 'slick-ml-edited']
      .filter(Boolean)
      .join(' ');

    // Dismiss actions live in the overflow menu; inline they read as message body.
    return React.createElement(
      'div',
      { className: classes || undefined },
      entry.edits?.length ? this.editHistory(entry.edits) : null,
      React.createElement(Original, props),
    );
  }

  /**
   * Slack builds the message menu from redux selectors, not a template prop, so
   * the rows are appended as extra children of the menu body.
   */
  private patchMenu() {
    const React = this.api.react;

    this.api.patchComponent<ActionsMenuProps>('MessageActionsMenu', (Original) => (props) => {
      const version = this.api.redux.usePatchVersion();
      const { channelId, ts, onTriggerClose } = props;
      const rows = React.useMemo(() => {
        const entry = channelId && ts ? this.entries.get(this.key(channelId, ts)) : undefined;
        if (!entry) return [];
        return [
          entry.edits?.length
            ? this.menuRow('slick_ml_hide_edits', 'Hide edit history', () => this.hideEdits(entry), onTriggerClose)
            : null,
          entry.deleted
            ? this.menuRow('slick_ml_accept_delete', 'Accept deletion', () => this.acceptDelete(entry), onTriggerClose)
            : null,
        ].filter((row) => row !== null);
      }, [channelId, ts, onTriggerClose, version]);

      return React.createElement(this.MenuRowsContext.Provider, { value: rows }, React.createElement(Original, props));
    });

    this.api.patchComponent<MenuProps>('Menu', (Original) => (props) => {
      const rows = React.useContext(this.MenuRowsContext);
      if (!rows.length) return React.createElement(Original, props);
      // Empty the context below so submenus (each its own `Menu`) don't get the rows.
      return React.createElement(
        this.MenuRowsContext.Provider,
        { value: [] },
        React.createElement(Original, props, props.children, rows),
      );
    });
  }

  /** Slack's `MenuItem` isn't addressable by name, so this mimics its markup; the classes are the contract. */
  private menuRow(key: string, label: string, click: () => void, close?: (event?: unknown) => void) {
    const React = this.api.react;
    return React.createElement(
      'div',
      { key, className: 'c-menu_item__li', role: 'presentation' },
      React.createElement(
        'button',
        {
          type: 'button',
          role: 'menuitem',
          className: 'c-menu_item__button',
          'data-qa': key,
          onClick: () => {
            click();
            close?.();
          },
        },
        React.createElement('div', { className: 'c-menu_item__label' }, label),
      ),
    );
  }

  private hideEdits(entry: LogEntry) {
    const key = this.key(entry.channel, entry.ts);
    const current = this.entries.get(key);
    if (!current) return;
    if (current.deleted) this.entries.set(key, { ...current, edits: undefined });
    else this.entries.delete(key);
    this.dirty.add(key);
    this.persist();
    this.api.redux.refresh();
  }

  private acceptDelete(entry: LogEntry) {
    this.forget(this.key(entry.channel, entry.ts));
    this.persist();
    this.api.redux.refresh();
  }

  private editHistory(edits: StoredEdit[]) {
    const React = this.api.react;
    return React.createElement(
      'span',
      { className: 'slick-ml-edited-original' },
      edits.map((edit, index) =>
        React.createElement(
          'span',
          { className: 'slick-ml-edited-original-line', key: index },
          React.createElement('s', null, edit.oldText || '(empty message)'),
          React.createElement('span', { className: 'slick-ml-edited-marker' }, '(edited)'),
        ),
      ),
    );
  }
}
