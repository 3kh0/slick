import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { withoutEventIngestion } from '../../media/noTelemetry.ts';

describe('withoutEventIngestion', () => {
  it('drops the event-ingestion URL and keeps every media endpoint', () => {
    const meeting = {
      MeetingId: 'm1',
      MediaRegion: 'us-east-2',
      MediaPlacement: {
        AudioHostUrl: 'audio.example:3478',
        SignalingUrl: 'wss://signal.example/control',
        TurnControlUrl: 'https://turn.example/v2/turn_sessions',
        EventIngestionUrl: 'https://data.svc.example/v1/client-events',
      },
    };
    const cleaned = withoutEventIngestion(meeting);
    assert.deepEqual(cleaned.MediaPlacement, {
      AudioHostUrl: 'audio.example:3478',
      SignalingUrl: 'wss://signal.example/control',
      TurnControlUrl: 'https://turn.example/v2/turn_sessions',
    });
    assert.equal(cleaned.MeetingId, 'm1');
    assert.ok('EventIngestionUrl' in meeting.MediaPlacement, "Slack's original object is left alone");
  });

  it('passes through meetings without a MediaPlacement', () => {
    const meeting = { MeetingId: 'm1' };
    assert.equal(withoutEventIngestion(meeting), meeting);
  });
});
