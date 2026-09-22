// Websocket events are observed at `routeMessages` (and, in degraded mode,
// `handleMessageImmediatelyWithoutPreprocessing`). Deletes arrive either as
// subtype `message_deleted` or with `rtmEventType` set to it depending on the
// connection, so every event is emitted under its type, subtype and routed type.

import { patchThunk } from './redux.ts';
import { patchExportFunction } from './webpack.ts';

export type RtmEvent = {
  type?: string;
  subtype?: string;
  [key: string]: any;
};

export type RtmListener = (event: RtmEvent) => void;

const listeners = new Map<string, Set<RtmListener>>();

function emit(event: RtmEvent | undefined, routedType?: string): void {
  if (!event) return;
  const keys = new Set<string>(['*']);
  if (routedType) keys.add(routedType);
  if (typeof event.type === 'string') keys.add(event.type);
  if (typeof event.subtype === 'string') keys.add(event.subtype);
  for (const key of keys) {
    const set = listeners.get(key);
    if (!set) continue;
    for (const listener of Array.from(set)) {
      try {
        listener(event);
      } catch (error) {
        console.error(`[slick] RTM listener for ${key} threw:`, error);
      }
    }
  }
}

type RoutedBatch = {
  messages?: { rtmEventType?: string; msgs?: RtmEvent[] };
};

patchExportFunction('routeMessages', (original) => (batch: RoutedBatch, ...rest: unknown[]) => {
  const { rtmEventType, msgs } = batch?.messages ?? {};
  for (const msg of msgs ?? []) emit(msg, rtmEventType ?? msg?.type);
  return original(batch, ...rest);
});

// Degraded mode skips the router, so events would go missing on a bad connection.
patchThunk('handleMessageImmediatelyWithoutPreprocessing', (original) => (...args: unknown[]) => {
  const event = args[0] as RtmEvent | undefined;
  emit(event, event?.type);
  return original(...args);
});

/** Listen for a websocket event by type or subtype, or `*` for all of them. */
export function onRtmEvent(type: string, listener: RtmListener): () => void {
  let set = listeners.get(type);
  if (!set) {
    set = new Set();
    listeners.set(type, set);
  }
  set.add(listener);
  return () => {
    set.delete(listener);
    if (set.size === 0) listeners.delete(type);
  };
}

export const rtmReady = (async () => ({ on: onRtmEvent }))();

export type RtmAPI = Awaited<typeof rtmReady>;
