import assert from 'node:assert/strict';
import { test } from 'node:test';
import { CHANNEL, createClient, MAX_PENDING } from './rpc.ts';
test('typed responses, correlation and duplicate response handling', async () => {
  const sent: any[] = [];
  const client = createClient((m) => sent.push(m));
  const result = client.call('readSettings');
  const response = { channel: CHANNEL, kind: 'response', id: sent[0].id, response: { ok: true, value: '{}' } };
  client.receive({ ...response, channel: 'other' });
  client.receive({ ...response, response: { ok: true, value: true } });
  client.receive(response);
  client.receive(response);
  assert.equal(await result, '{}');
  client.disconnect();
});
test('timeout, send failure, pending limit and disconnect reject', async () => {
  const timeout = createClient(() => {}, 5);
  await assert.rejects(timeout.call('readSettings'), /timed out/);
  const failed = createClient(() => {
    throw new Error('no transport');
  });
  await assert.rejects(failed.call('readSettings'), /send failed/);
  const client = createClient(() => {});
  const pending = Array.from({ length: MAX_PENDING }, () =>
    assert.rejects(client.call('readSettings'), /disconnected/),
  );
  await assert.rejects(client.call('readSettings'), /unavailable/);
  client.disconnect();
  await Promise.all(pending);
  await assert.rejects(client.call('readSettings'), /unavailable/);
});
