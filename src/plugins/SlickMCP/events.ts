import { eventMatches, eventSummary, type EventFilter } from './features.ts';
import type { RtmEvent } from '../../app/slack/rtm.ts';

type BufferEntry = { sequence: number; event: unknown };
type Subscription = {
  id: string;
  sequence: number;
  entries: BufferEntry[];
  updated: number;
  remove: () => void;
  scope: string;
  timer?: ReturnType<typeof setTimeout>;
};

export class EventBuffers {
  private subscriptions = new Map<string, Subscription>();
  private subscribe: (listener: (event: RtmEvent) => void) => () => void;
  private now: () => number;
  private getScope: () => string;
  constructor(subscribe: (listener: (event: RtmEvent) => void) => () => void, now = Date.now, getScope = () => '') {
    this.subscribe = subscribe;
    this.now = now;
    this.getScope = getScope;
  }

  private expire() {
    for (const [id, subscription] of this.subscriptions)
      if (subscription.updated < this.now() - 30 * 60 * 1000) this.remove(id);
  }

  create(filter: EventFilter) {
    this.expire();
    if (this.subscriptions.size >= 16) throw new Error('Event subscription limit reached (16 per window)');
    const id = crypto.randomUUID();
    const subscription: Subscription = {
      id,
      scope: this.getScope(),
      sequence: 0,
      entries: [],
      updated: this.now(),
      remove: () => {},
    };
    subscription.remove = this.subscribe((event) => {
      if (subscription.updated < this.now() - 30 * 60 * 1000) {
        this.remove(id);
        return;
      }
      if (subscription.scope !== this.getScope()) {
        this.remove(id);
        return;
      }
      if (!eventMatches(event, filter)) return;
      const value = filter.include_content ? event : eventSummary(event);
      const encoded = JSON.stringify(value);
      const bounded = encoded.length > 16384 ? { ...eventSummary(event), truncated: true } : JSON.parse(encoded);
      subscription.entries.push({ sequence: ++subscription.sequence, event: bounded });
      if (subscription.entries.length > 200) subscription.entries.shift();
    });
    this.subscriptions.set(id, subscription);
    this.scheduleExpiry(subscription);
    return { subscription_id: id, cursor: `${id}:0`, capacity: 200, idle_ttl_ms: 1800000 };
  }

  private scheduleExpiry(subscription: Subscription) {
    clearTimeout(subscription.timer);
    subscription.timer = setTimeout(
      () => {
        this.remove(subscription.id);
      },
      30 * 60 * 1000,
    );
    subscription.timer.unref?.();
  }

  poll(id: string, cursor: string, limit: number) {
    this.expire();
    const subscription = this.subscriptions.get(id);
    if (subscription && subscription.scope !== this.getScope()) {
      this.remove(id);
      throw new Error('Workspace changed; create a new event subscription');
    }
    if (!subscription) throw new Error('Event subscription expired or does not exist in this window');
    if (!cursor.startsWith(`${id}:`)) throw new Error('Cursor belongs to another subscription');
    const offset = cursor.slice(id.length + 1);
    if (!/^\d+$/.test(offset) || !Number.isSafeInteger(Number(offset)) || Number(offset) > subscription.sequence)
      throw new Error('Invalid event cursor');
    subscription.updated = this.now();
    this.scheduleExpiry(subscription);
    const sequence = Number(offset);
    const first = subscription.entries[0]?.sequence ?? subscription.sequence + 1;
    const events = subscription.entries.filter((entry) => entry.sequence > sequence).slice(0, limit);
    const last = events.at(-1)?.sequence ?? sequence;
    return {
      subscription_id: id,
      events,
      cursor: `${id}:${last}`,
      gap: sequence < first - 1,
      has_more: last < subscription.sequence,
    };
  }

  remove(id: string) {
    const subscription = this.subscriptions.get(id);
    if (subscription) {
      clearTimeout(subscription.timer);
      subscription.remove();
      this.subscriptions.delete(id);
    }
    return { removed: !!subscription };
  }

  stop() {
    for (const id of this.subscriptions.keys()) this.remove(id);
  }
}
