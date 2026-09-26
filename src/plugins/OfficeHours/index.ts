import { SlickPlugin } from '$slick';
import type { ScheduleRule } from '../../shared/settings.ts';
import * as meta from './meta.ts';
import { activeUntil } from './schedule.ts';

// Slack's own out of office preset; `status_text_canonical` is what marks it.
const OOO_TEXT = 'Out of office';
const OOO_EMOJI = ':no_entry:';
const TICK_MS = 30_000;
// Our own change reaches Slack's store over RTM; don't mistake the lag for a manual edit.
const SETTLE_MS = 60_000;
const STORAGE_KEY = 'state';

type Kind = 'ooo' | 'invisible';
const KINDS: Kind[] = ['ooo', 'invisible'];

type Held = { until: number; since: number; snoozed?: boolean };

type State = {
  held: Partial<Record<Kind, Held>>;
  backoff: Partial<Record<Kind, number>>;
};

export default class OfficeHours extends SlickPlugin<typeof meta.settings> {
  static readonly id = meta.id;
  static readonly pluginName = meta.pluginName;
  static readonly description = meta.description;
  static readonly defaultEnabled = meta.defaultEnabled;
  static readonly settings = meta.settings;
  static readonly liveSettings = Object.keys(meta.settings);

  private state: State = { held: {}, backoff: {} };
  private key: string | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;
  private queue: Promise<void> = Promise.resolve();
  private warned = false;
  private reapply = false;

  start() {
    // A late tick is harmless: each one works from the clock, not a count.
    this.timer = setInterval(() => this.schedule(), TICK_MS);
    this.schedule();
  }

  async stop() {
    if (this.timer) clearInterval(this.timer);
    await this.queue;
    // Disabled: hand back whatever is still ours.
    for (const kind of KINDS) if (this.state.held[kind]) await this.release(kind).catch(this.warn);
    await this.save();
  }

  onSettingsChange(changed: string[]) {
    // Re-apply so a new message or pause setting takes effect mid-window.
    if (changed.includes('oooMessage') || changed.includes('pauseNotifications')) this.reapply = true;
    this.schedule();
  }

  private schedule() {
    this.queue = this.queue.then(() => this.tick()).catch(this.warn);
  }

  private async tick() {
    const self = this.self();
    if (!self || this.api.signal.aborted) return;
    // self() found a member, so there is a current member id.
    await this.load(this.api.members.getCurrentMemberId()!);
    if (this.api.signal.aborted) return;
    if (this.reapply && this.state.held.ooo) this.state.held.ooo.until = 0;
    this.reapply = false;

    const now = new Date();
    const rules = this.config.schedule as ScheduleRule[];
    let changed = false;

    for (const kind of KINDS) {
      const until = activeUntil(rules, kind, now)?.getTime();
      const held = this.state.held[kind];
      const backoff = this.state.backoff[kind];

      if (backoff !== undefined && (!until || now.getTime() >= backoff)) {
        delete this.state.backoff[kind];
        changed = true;
      }

      if (held && now.getTime() - held.since > SETTLE_MS && !this.isSet(kind, self)) {
        // Changed by hand (or by another app): back off for the rest of the window.
        delete this.state.held[kind];
        if (until) this.state.backoff[kind] = until;
        changed = true;
        this.log(`${kind} changed outside the schedule; leaving it alone`);
        continue;
      }

      if (!until) {
        if (held) {
          await this.release(kind);
          changed = true;
        }
        continue;
      }

      if (this.state.backoff[kind] !== undefined) continue;
      if (held?.until === until) continue;
      // Already out of office or away on their own: not ours to undo later.
      if (!held && this.isSet(kind, self)) continue;

      this.state.held[kind] = await this.apply(kind, until, held);
      changed = true;
    }

    if (changed) await this.save();
  }

  /**
   * On the web every Slack tab runs its own copy, maybe signed in to another
   * workspace: keep one record per user and re-read it each tick so tabs agree.
   */
  private async load(userId: string) {
    const shared = this.api.loader !== 'electron';
    const key = shared ? `${STORAGE_KEY}:${userId}` : STORAGE_KEY;
    if (!shared && this.key === key) return;
    // Null is missing or unreadable; keep what we have rather than forget what we hold.
    const stored = await this.api.storage.get<State | null>(key, null);
    if (stored) this.state = { held: stored.held ?? {}, backoff: stored.backoff ?? {} };
    else if (this.key !== key) this.state = { held: {}, backoff: {} };
    this.key = key;
  }

  private self() {
    const id = this.api.members.getCurrentMemberId();
    return id ? this.api.members.getCachedMember(id) : undefined;
  }

  private isSet(kind: Kind, self: any): boolean {
    return kind === 'ooo' ? self.profile?.status_text_canonical === OOO_TEXT : self.manual_presence === 'away';
  }

  private async apply(kind: Kind, until: number, held: Held | undefined): Promise<Held> {
    const options = { rateLimitRetries: 2, signal: this.api.signal };
    const since = Date.now();
    if (kind === 'invisible') {
      await this.api.userAPI('users.setPresence', { presence: 'away' }, options);
      this.log(`invisible until ${new Date(until).toLocaleString()}`);
      return { until, since };
    }

    // Expiring with the window means Slack clears it even if Slick isn't running then.
    await this.api.userAPI(
      'users.profile.set',
      {
        profile: JSON.stringify({
          status_emoji: OOO_EMOJI,
          status_text: OOO_TEXT,
          status_text_canonical: OOO_TEXT,
          status_expiration: Math.floor(until / 1000),
          ooo_message: oooMessageBlocks(String(this.config.oooMessage ?? '')),
        }),
      },
      options,
    );
    const snoozed = this.config.pauseNotifications === true;
    if (snoozed) {
      const minutes = Math.max(1, Math.ceil((until - Date.now()) / 60_000));
      await this.api.userAPI('dnd.setSnooze', { num_minutes: String(minutes) }, options);
    } else if (held?.snoozed) {
      await this.api.userAPI('dnd.endSnooze', {}, options).catch(() => {});
    }
    this.log(`out of office until ${new Date(until).toLocaleString()}`);
    return { until, since, snoozed };
  }

  /** Only undoes what is still ours; Slack may already have expired the status. */
  private async release(kind: Kind) {
    const held = this.state.held[kind];
    delete this.state.held[kind];
    const self = this.self();
    // No signal: this also runs from stop(), after which the plugin's signal aborts.
    const options = { rateLimitRetries: 2 };

    if (kind === 'invisible') {
      if (self?.manual_presence === 'away' && this.config.inOffice !== 'away') {
        await this.api.userAPI('users.setPresence', { presence: 'auto' }, options);
      }
    } else {
      if (self?.profile?.status_text_canonical === OOO_TEXT) {
        await this.api.userAPI(
          'users.profile.set',
          {
            profile: JSON.stringify({
              status_emoji: '',
              status_text: '',
              status_text_canonical: '',
              status_expiration: 0,
              ooo_message: '',
            }),
          },
          options,
        );
      }
      if (held?.snoozed) await this.api.userAPI('dnd.endSnooze', {}, options).catch(() => {});
    }
    this.log(`${kind} ended`);
  }

  private async save() {
    if (this.key) await this.api.storage.set(this.key, this.state);
  }

  private warn = (error: unknown) => {
    if (this.warned) return;
    this.warned = true;
    console.warn('[slick] [Office Hours] could not update your status:', error);
  };
}

//* Slack drops a plain-text `ooo_message`; it wants rich_text blocks!
function oooMessageBlocks(text: string): string {
  if (!text.trim()) return '';
  return JSON.stringify([
    { type: 'rich_text', elements: [{ type: 'rich_text_section', elements: [{ type: 'text', text }] }] },
  ]);
}
