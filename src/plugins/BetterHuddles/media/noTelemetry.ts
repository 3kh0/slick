// The Chime SDK is only here to carry the huddle to and from Slack's media
// servers. Its one optional side channel is meeting-event reporting: when the
// meeting has `MediaPlacement.EventIngestionUrl`, the SDK POSTs events
// (browser, OS, device name, meeting history, ids) to Amazon's ingestion
// service. That isn't needed for the call, so the URL is removed here, and
// chimeMedia.ts also installs a no-op event reporter in case it slips through.

/** A copy of Slack's Chime meeting without the event-ingestion endpoint. */
export function withoutEventIngestion(meeting: Record<string, unknown>): Record<string, unknown> {
  const placement = meeting.MediaPlacement;
  if (!placement || typeof placement !== 'object') return meeting;
  const transport: Record<string, unknown> = { ...placement };
  delete transport.EventIngestionUrl;
  return { ...meeting, MediaPlacement: transport };
}
