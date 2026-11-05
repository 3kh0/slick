import assert from 'node:assert/strict';
import { test } from 'node:test';
import { chatLabel, chatMemberIds } from './people.ts';

test('DM avatars include the peer, including a DM to yourself', () => {
  assert.deepEqual(chatMemberIds({ is_im: true, user: 'U1' }, 'U1'), ['U1']);
  assert.deepEqual(chatMemberIds({ is_im: true }), []);
  assert.deepEqual(chatMemberIds({ is_channel: true }), []);
});

test('group avatar stacks exclude yourself, deduplicate, and tolerate missing members', () => {
  assert.deepEqual(chatMemberIds({ is_mpim: true, members: ['U1', 'U2', 'U2', 'W3', null, {}] }, 'U1'), ['U2', 'W3']);
  assert.deepEqual(chatMemberIds({ is_mpim: true, members: ['U1'] }, 'U1'), ['U1']);
  assert.deepEqual(chatMemberIds({ is_mpim: true }), []);
});

test('group labels use participant names instead of internal mpdm slugs', () => {
  const state = {
    channels: Object.create({
      D1: { is_im: true, user: 'U2' },
      G1: { is_mpim: true, name: '@sam,oldusername', members: ['U1', 'U2', 'U3'] },
      C1: { name: 'general' },
    }),
    members: Object.create({ U2: { profile: { display_name: 'Sam' } }, U3: { real_name: 'Alex' } }),
  };
  assert.equal(chatLabel(state, 'D1', 'U1'), 'Sam');
  assert.equal(chatLabel(state, 'G1', 'U1'), 'Alex, Sam');
  assert.equal(chatLabel(state, 'C1', 'U1'), 'general');
  assert.equal(chatLabel(state, 'D2', 'U1'), 'D2');
});
