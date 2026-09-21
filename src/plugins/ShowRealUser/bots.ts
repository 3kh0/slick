// Relay bots that post on someone else's behalf, and where each records who.
//
// This is an allow-list on purpose. Any bot can put a `source_user_id` in its
// message metadata, and honouring it blindly would let an arbitrary app make a
// message appear to come from anyone. Only bots known to be relays are trusted
// to name their sender.
//
// The list is Taut's (MIT, github.com/jeremy46231/taut), which tracks the same
// workspace and is more complete than v1's three entries.

import type { SlackMessage } from '$slick';

export type RelayedMessage = SlackMessage & {
  metadata?: { event_type?: string; event_payload?: Record<string, unknown> };
};

export const RELAY_BOTS: Record<string, (msg: RelayedMessage) => unknown> = {
  // at-channel
  B08G06U6SJG: (msg) => msg.metadata?.event_payload?.source_user_id,
  // Prometheus
  B0AL9MCCBJL: (msg) => msg.metadata?.event_payload?.source_user_id,
  // Slack Extra
  B09QQ24JRL1: (msg) => msg.metadata?.event_payload?.poster,
  // bChannel
  B0BJDMND6HX: (msg) => msg.metadata?.event_payload?.source_user_id,
  // Ping Bot
  B0BEYA2UKPZ: (msg) => msg.metadata?.event_payload?.source_user_id,
  // nChannel
  B0BJB280JP8: (msg) => msg.metadata?.event_payload?.source_user_id,
  // shroud
  B07KBDVFXJP: (msg) => msg.metadata?.event_payload?.source_user_id,
  B0B4KEDP7BL: (msg) => msg.metadata?.event_payload?.source_user_id, // demo
  // fraudpheus
  B091HC53AR2: (msg) => msg.metadata?.event_payload?.source_user_id,
  // nemo
  B0BQFDMCL0H: (msg) => msg.metadata?.event_payload?.source_user_id, // dev
  // forge
  B0APKS1DZAQ: (msg) => msg.metadata?.event_payload?.source_user_id,
  // izie's pet
  B0AJHVBLHUN: (msg) => msg.metadata?.event_payload?.source_user_id,
};
