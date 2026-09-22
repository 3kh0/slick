import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  broadcastKinds,
  commandOps,
  deltaCandidateKinds,
  isChannelId,
  normalizeRestrictedBroadcasts,
  notificationTextFromBlocks,
  originOf,
  textBroadcastKinds,
} from './broadcast.ts';
import { parseWhoCanPost, postingPrefWithBot, prefAllowsBot } from './ready.ts';

test('isChannelId: channels and groups only', () => {
  assert.equal(isChannelId('C123ABC'), true);
  assert.equal(isChannelId('G123ABC'), true);
  assert.equal(isChannelId('D123ABC'), false);
  assert.equal(isChannelId('U123ABC'), false);
});

test('textBroadcastKinds: mrkdwn and typed mentions', () => {
  const kinds = textBroadcastKinds('hello <!channel> and @here');
  assert.deepEqual([...kinds].toSorted(), ['channel', 'here']);
  assert.equal(textBroadcastKinds('email@here.com').size, 0);
});

test('deltaCandidateKinds: mention ops and typed text, not code', () => {
  const delta = {
    ops: [
      { insert: '@channel', attributes: { slackmention: { id: 'BKchannel' } } },
      { insert: ' and @here in code', attributes: { code: true } },
    ],
  };
  const kinds = deltaCandidateKinds(delta);
  assert.equal(kinds.has('channel'), true);
  assert.equal(kinds.has('here'), false);
});

test('normalizeRestrictedBroadcasts: typed @channel becomes a broadcast node', () => {
  const found = new Set<'channel' | 'here'>();
  const out = normalizeRestrictedBroadcasts(
    { type: 'rich_text', elements: [{ type: 'text', text: 'hi @channel there' }] },
    false,
    found,
  ) as { elements: unknown[] };
  assert.equal(found.has('channel'), true);
  assert.deepEqual(out.elements, [
    { type: 'text', text: 'hi ' },
    { type: 'broadcast', range: 'channel' },
    { type: 'text', text: ' there' },
  ]);
});

test('normalizeRestrictedBroadcasts: leaves code blocks alone', () => {
  const found = new Set<'channel' | 'here'>();
  const input = { type: 'rich_text_preformatted', elements: [{ type: 'text', text: '@channel' }] };
  const out = normalizeRestrictedBroadcasts(input, false, found);
  assert.equal(found.size, 0);
  assert.deepEqual(out, {
    type: 'rich_text_preformatted',
    elements: [{ type: 'text', text: '@channel' }],
  });
});

test('broadcastKinds: walks nested blocks', () => {
  const kinds = broadcastKinds([{ type: 'rich_text', elements: [{ type: 'broadcast', range: 'here' }] }]);
  assert.equal(kinds.has('here'), true);
});

test('notificationTextFromBlocks: renders mentions without re-triggering', () => {
  const text = notificationTextFromBlocks(
    [
      {
        type: 'rich_text',
        elements: [
          {
            type: 'rich_text_section',
            elements: [
              { type: 'broadcast', range: 'channel' },
              { type: 'text', text: ' hello' },
            ],
          },
        ],
      },
    ],
    '@channel hello',
  );
  assert.equal(text, '@channel hello');
});

test('commandOps: prefixes the staged token as a slash command', () => {
  assert.deepEqual(commandOps('abc'), [{ insert: '/bchannel abc\n' }]);
});

test('originOf: https and loopback http only', () => {
  assert.equal(originOf('https://bc.example.dev/path'), 'https://bc.example.dev');
  assert.equal(originOf('http://localhost:8787'), 'http://localhost:8787');
  assert.equal(originOf('http://evil.example'), 'https://bc.deployor.dev');
});

test('prefAllowsBot: unrestricted or bot already listed', () => {
  assert.equal(prefAllowsBot({}, 'U1'), true);
  assert.equal(prefAllowsBot({ pref_value: { type: ['ra'], user: [] } }, 'U1'), true);
  assert.equal(prefAllowsBot({ pref_value: { type: ['admin'], user: [] } }, 'U1'), false);
  assert.equal(prefAllowsBot({ pref_value: { type: ['admin'], user: ['U1'] } }, 'U1'), true);
});

test('postingPrefWithBot: appends the bot without dropping existing entries', () => {
  const pref = parseWhoCanPost('type:admin,user:U9');
  assert.equal(postingPrefWithBot(pref, 'U1'), 'type:admin,user:U9,user:U1');
  assert.equal(postingPrefWithBot(pref, 'U9'), 'type:admin,user:U9');
});

test('parseWhoCanPost: accepts the thunk shape and a prefs wrapper', () => {
  const thunk = parseWhoCanPost({ pref_value: { type: ['owner'], user: [] } });
  assert.deepEqual(thunk.pref_value?.type, ['owner']);
  const wrapped = parseWhoCanPost({ prefs: { who_can_post: 'type:admin' } });
  assert.deepEqual(wrapped.pref_value?.type, ['admin']);
});
