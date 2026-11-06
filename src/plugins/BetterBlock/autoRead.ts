import { blockedDm, hidesMessage, isHuddle, type Blocked, type Data } from './filter.ts';

type Options = {
  getState(): Data | undefined;
  getBlocked(): Blocked;
  isActive(): boolean;
  markRead(id: string, ts: string): Promise<unknown>;
  onError(error: unknown): void;
};
const validTs = (ts: unknown): ts is string => typeof ts === 'string' && /^\d+\.\d+$/.test(ts);
const scopeOf = (state: Data | undefined) =>
  state?.bootData?.user_id
    ? `${state.bootData.enterprise_id ?? state.bootData.team_id ?? ''}:${state.bootData.user_id}`
    : '';

/** Coalesce bursts and serialize marks so an older request cannot undo a newer
 * read cursor. The raw store is used because the visible history is filtered. */
export class BlockedDmReader {
  private pending = new Map<string, { ts: string; scope: string }>();
  private completed = new Map<string, string>();
  private timer?: ReturnType<typeof setTimeout>;
  private running = false;
  private rescan = false;
  private stopped = false;
  private scope = '';
  private channels: unknown;
  private latest: unknown;

  private options: Options;

  constructor(options: Options) {
    this.options = options;
  }

  observe() {
    const state = this.options.getState();
    const scope = scopeOf(state);
    if (state?.channels === this.channels && state?.channelLatests === this.latest && scope === this.scope) return;
    this.sync(scope);
    this.channels = state?.channels;
    this.latest = state?.channelLatests;
    this.schedule();
  }

  private sync(scope: string) {
    if (scope === this.scope) return;
    this.scope = scope;
    this.pending.clear();
    this.completed.clear();
  }

  private isRead(state: Data | undefined, id: string, ts: string) {
    const cursor = state?.channelCursors?.[id];
    return (validTs(cursor) && Number(cursor) >= Number(ts)) || Number(this.completed.get(id) ?? 0) >= Number(ts);
  }

  schedule() {
    if (this.stopped || !this.options.isActive() || this.timer) return;
    this.timer = setTimeout(() => {
      this.timer = undefined;
      void this.flush();
    }, 200);
  }

  onMessage(event: Data) {
    if (
      this.stopped ||
      !this.options.isActive() ||
      event.subtype === 'message_changed' ||
      event.subtype === 'message_deleted'
    )
      return;
    const state = this.options.getState();
    const channel = state?.channels?.[event.channel];
    // The store observer picks up unknown DMs after Slack hydrates their channels.
    if (!blockedDm(channel, this.options.getBlocked()) || !hidesMessage(event, this.options.getBlocked())) return;
    if (event.thread_ts && event.thread_ts !== event.ts) return;
    this.enqueue(state, event.channel, event.ts);
    this.schedule();
  }

  private enqueue(state: Data | undefined, id: string, ts: unknown) {
    const scope = scopeOf(state);
    if (!scope || !validTs(ts)) return;
    this.sync(scope);
    if (!this.isRead(state, id, ts) && Number(this.pending.get(id)?.ts ?? 0) < Number(ts))
      this.pending.set(id, { ts, scope });
  }

  async flush() {
    if (this.timer) clearTimeout(this.timer);
    this.timer = undefined;
    if (this.stopped || !this.options.isActive()) return;
    if (this.running) {
      this.rescan = true;
      return;
    }
    const state = this.options.getState();
    for (const id in state?.channels) {
      if (!blockedDm(state!.channels[id], this.options.getBlocked())) continue;
      const ts = state?.channelLatests?.[id];
      const message = state?.messages?.[id]?.[ts];
      if (isHuddle(message) || (message?.thread_ts && message.thread_ts !== ts)) continue;
      this.enqueue(state, id, ts);
    }
    this.running = true;
    try {
      for (const [id, mark] of this.pending) {
        this.pending.delete(id);
        const current = this.options.getState();
        if (this.stopped || !this.options.isActive()) break;
        if (scopeOf(current) !== mark.scope || !blockedDm(current?.channels?.[id], this.options.getBlocked())) continue;
        if (this.isRead(current, id, mark.ts)) continue;
        try {
          await this.options.markRead(id, mark.ts);
          if (scopeOf(this.options.getState()) === mark.scope) this.completed.set(id, mark.ts);
        } catch (error) {
          if (!this.stopped && this.options.isActive()) this.options.onError(error);
        }
      }
    } finally {
      this.running = false;
      if (this.rescan) {
        this.rescan = false;
        this.schedule();
      }
    }
  }

  stop() {
    this.stopped = true;
    if (this.timer) clearTimeout(this.timer);
    this.timer = undefined;
    this.pending.clear();
    this.completed.clear();
  }
}
