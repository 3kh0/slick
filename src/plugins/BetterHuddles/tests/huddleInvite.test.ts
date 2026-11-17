import assert from 'node:assert/strict';
import { test } from 'node:test';
import { IDLE_CALL, type CallState } from '../huddleCall.ts';
import { completeInviteSearch, inviteHuddleMember, inviteSearchResults } from '../huddleInvite.ts';

test('invite search accepts people, removes duplicates and excludes deactivated accounts and bots', () => {
  const person = { type: 'member', item: { id: 'U123', profile: { display_name: 'Test Person' } } };
  assert.deepEqual(
    inviteSearchResults([
      null,
      {},
      person,
      person,
      { type: 'channel', item: { id: 'C123', name: 'channel' } },
      { type: 'member', item: { id: 'U456', name: 'Deleted', deleted: true } },
      { type: 'member', item: { id: 'U789', name: 'Bot', is_bot: true } },
      { type: 'member', item: { id: 'UABC', name: 'App', is_app_user: true } },
      { type: 'member', item: { id: 'UDEF', name: 'fallback' } },
    ]),
    [
      { id: 'U123', name: 'Test Person' },
      { id: 'UDEF', name: 'fallback' },
    ],
  );
  assert.deepEqual(inviteSearchResults({}), []);
});

function fixture() {
  const call: CallState = {
    ...IDLE_CALL,
    status: 'connected' as const,
    roomId: 'R1',
    channelId: 'C1',
    localUserId: 'U1',
    participants: ['U1', 'U2'],
  };
  const notifications: unknown[] = [];
  return {
    call,
    notifications,
    args: {
      getCall: () => call,
      roomId: 'R1',
      userId: 'U3',
      notify: async (args: unknown) => {
        notifications.push(args);
      },
    },
  };
}

test('invites a person through Slack’s native huddle notification using the active channel', async () => {
  const f = fixture();
  await inviteHuddleMember(f.args);
  assert.deepEqual(f.notifications, [{ channelId: 'C1', userId: 'U3', reason: 'huddle-notify-member' }]);
});

test('a stale picker cannot invite into a different or ended call', async () => {
  const f = fixture();
  f.call.roomId = 'R2';
  await assert.rejects(inviteHuddleMember(f.args), /ended/);
  f.args.getCall = () => ({ ...f.call, ...IDLE_CALL });
  await assert.rejects(inviteHuddleMember(f.args), /ended/);
  assert.deepEqual(f.notifications, []);
});

test('does not invite yourself, existing participants or invalid ids', async () => {
  const f = fixture();
  for (const userId of ['U1', 'U2', '', 'C123']) await assert.rejects(inviteHuddleMember({ ...f.args, userId }));
  assert.deepEqual(f.notifications, []);
});

test('surfaces Slack invitation failures to the picker for retry', async () => {
  const f = fixture();
  await assert.rejects(
    inviteHuddleMember({
      ...f.args,
      notify: async () => {
        throw new Error('not_allowed');
      },
    }),
    /not_allowed/,
  );
});

test('picker entries include profile photos and distinct real names, with safe image URLs', () => {
  const item = {
    id: 'U123',
    profile: { display_name: 'Alt', real_name: 'Test Account', image_48: 'https://example.com/avatar.png' },
  };
  assert.deepEqual(inviteSearchResults([{ type: 'member', item }]), [
    { id: 'U123', name: 'Alt', realName: 'Test Account', avatarUrl: 'https://example.com/avatar.png' },
  ]);
  assert.equal(
    inviteSearchResults([
      { type: 'member', item: { ...item, profile: { ...item.profile, image_48: 'javascript:alert(1)' } } },
    ])[0]?.avatarUrl,
    undefined,
  );
});

test('combines local suggestions and Slack’s deferred remote results without duplicates', async () => {
  const item = (id: string, name: string) => ({ type: 'member', item: { id, name } });
  const results = Object.assign([item('U1', 'Local')], {
    promise: Promise.resolve([item('U1', 'Updated'), item('U2', 'Remote')]),
  });
  assert.deepEqual(await completeInviteSearch(results), [
    { id: 'U1', name: 'Updated' },
    { id: 'U2', name: 'Remote' },
  ]);
  assert.deepEqual(await completeInviteSearch(undefined), []);
});
