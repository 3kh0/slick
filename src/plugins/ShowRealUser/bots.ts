// Relay bots that post on someone else's behalf, and where each records who.
// An allow-list on purpose: any bot can set source_user_id, so trusting it
// blindly would let any app impersonate anyone.
//
// List from Taut (MIT, github.com/jeremy46231/taut).

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
