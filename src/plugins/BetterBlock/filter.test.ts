import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  blockedDm,
  filterContent,
  filterHistory,
  filterMessage,
  filterReaction,
  filterReactions,
  filterThreadActivity,
  filterTyping,
  hasBlockedReplies,
  hidesActivity,
  hidesMessage,
  hidesSuggestion,
  projectSuggestions,
  threadReplies,
} from './filter.ts';

const blocked = new Set(['UBLOCKED']);

test('typing removes keys, including inherited entries, so native selectors never dereference undefined', () => {
  const inherited = { blocked: { channelId: 'C1', memberId: 'UBLOCKED', threadTs: '1' } };
  const typing = Object.assign(Object.create(inherited), {
    allowed: { channelId: 'C1', memberId: 'UOTHER', threadTs: '1' },
    blockedDm: { channelId: 'D1', memberId: 'UBLOCKED' },
  });
  const next = filterTyping(typing, blocked);
  assert.deepEqual(Object.keys(next), ['allowed']);
  assert.equal('blocked' in next, false);
  assert.equal('blockedDm' in next, false);
  assert.equal(
    Object.values<any>(next).some((typer) => typer.channelId === 'D1'),
    false,
  );
  assert.equal(
    Object.values<any>(next).some((typer) => typer.channelId === 'C1' && typer.threadTs === '1'),
    true,
  );
  assert.equal(typing.blocked, inherited.blocked);
  assert.equal(filterTyping(typing, new Set()), typing);
  assert.equal(filterTyping(next, blocked), next);
});

test('blocked replies do not remove a thread; its preview and known unread count exclude them', () => {
  const messages = Object.create({
    '1': { ts: '1', user: 'UROOT' },
    '2': { ts: '2', thread_ts: '1', user: 'UOTHER' },
    '3': { ts: '3', thread_ts: '1', user: 'UBLOCKED' },
    '4': { ts: '4', thread_ts: 'elsewhere', user: 'UOTHER' },
  });
  const state = { messages: { C1: messages } };
  const item = {
    type: 'thread_v2',
    key: 'thread-C1-1',
    channelId: 'C1',
    threadTs: '1',
    ts: '3',
    messageTs: '3',
    feedTs: '3',
    latestTs: '3',
    minUnreadTs: '2',
    unreadCount: 2,
    isUnread: true,
  };
  const next = filterThreadActivity(item, state, blocked);
  assert.equal(hidesActivity(item, state, blocked), false);
  assert.deepEqual([next.messageTs, next.feedTs, next.latestTs], ['2', '2', '2']);
  assert.equal(next.unreadCount, 1);
  assert.deepEqual([next.key, next.ts, next.threadTs, next.isUnread], [item.key, '3', '1', true]);
  assert.equal(item.feedTs, '3');
  assert.equal(filterThreadActivity(item, state, new Set()), item);
  assert.equal(hidesActivity(item, { ...state, channels: { C1: { is_im: true, user: 'UBLOCKED' } } }, blocked), true);
});

test('thread previews fall back to the root or empty content without leaking blocked or unrelated messages', () => {
  const item = { type: 'thread_v2', channelId: 'C1', threadTs: '1', feedTs: '3', latestTs: '3', messageTs: '3' };
  const state = {
    messages: {
      C1: {
        '1': { ts: '1', user: 'UOTHER' },
        '3': { ts: '3', user: 'UBLOCKED', thread_ts: '1' },
        '2': { ts: '2', user: 'UOTHER', thread_ts: 'unrelated' },
      },
    },
  };
  assert.equal(filterThreadActivity(item, state, blocked).feedTs, '1');
  state.messages.C1['1'].user = 'UBLOCKED';
  const next = filterThreadActivity(item, state, blocked);
  assert.equal(next.feedTs, undefined);
  assert.equal(next.latestTs, undefined);
  assert.equal(next.threadTs, '1');
  assert.equal(hidesActivity(next, state, blocked), false);
  assert.equal(filterThreadActivity(item, { messages: {} }, blocked), item, 'unloaded history is not assumed blocked');
});

test('global search filters member, DM, group DM and member-filter suggestions, preserving huddles and plain queries', () => {
  for (const suggestion of [
    { type: 'member', id: 'UBLOCKED' },
    { user: { id: 'UBLOCKED' } },
    { item: { id: 'UBLOCKED' }, source: 'remote' },
    { im: { is_im: true, user: 'UBLOCKED' } },
    { type: 'mpim', item: { members: ['UOTHER', 'UBLOCKED'] } },
    { lastTokenMemberOrNull: { id: 'UBLOCKED' } },
    { suggestion_replacement_ops: [{ attributes: { slacksearchfilter: { entityId: 'UBLOCKED' } } }] },
  ])
    assert.equal(hidesSuggestion(suggestion, blocked), true);
  assert.equal(hidesSuggestion({ type: 'huddle', user: { id: 'UBLOCKED' } }, blocked), false);
  assert.equal(hidesSuggestion({ type: 'queryUser', suggestion_replacement: 'fred' }, blocked), false);
  assert.equal(hidesSuggestion({ type: 'member', id: 'UOTHER' }, blocked), false);
});

test('global search keeps mouse, arrow navigation, ghost text and default Enter in the same index space', () => {
  const items = [{ id: 'UBLOCKED' }, { id: 'query' }, { id: 'UOTHER' }];
  const initial = projectSuggestions(items, null, blocked);
  assert.deepEqual(initial.suggestions, items.slice(1));
  assert.equal(initial.needsSync, true);
  assert.equal(initial.canAccept, false, 'do not accept the hidden default before upstream selection catches up');
  assert.equal(initial.nextSourceIndex, 1);
  assert.equal(initial.selectedIndex, 0);
  assert.equal(initial.sourceIndex(1), 2);
  assert.equal(initial.sourceIndex(null), 1, 'clearing selection must not restore the hidden default');
  const synced = projectSuggestions(items, 1, blocked);
  assert.equal(synced.selectedIndex, 0);
  assert.equal(synced.needsSync, false);
  assert.equal(synced.canAccept, true);
  const later = projectSuggestions(items, 2, blocked);
  assert.equal(later.selectedIndex, 1);
  assert.equal(later.sourceIndex(0), 1);
  assert.equal(projectSuggestions(items.slice(0, 1), null, blocked).canAccept, false);
  assert.equal(projectSuggestions(items, null, new Set()).suggestions, items, 'unblocking restores original results');
  assert.equal(items.length, 3, 'never mutate the upstream list');
});

test('hides authors and delegated senders but preserves huddle messages', () => {
  assert.equal(hidesMessage({ user: 'UBLOCKED' }, blocked), true);
  assert.equal(hidesMessage({ user: 'UOTHER', delegate_sender_user_id: 'UBLOCKED' }, blocked), true);
  assert.equal(hidesMessage({ user: 'UOTHER' }, blocked), false);
  assert.equal(hidesMessage(undefined, blocked), false);
  const huddle = { user: 'UBLOCKED', subtype: 'huddle_thread', reply_users: ['UBLOCKED'] };
  assert.equal(hidesMessage(huddle, blocked), false);
  assert.equal(filterMessage(huddle, blocked), huddle);
});

test('removes only blocked reactions and sanitizes grouped tooltips without double decrementing', () => {
  const original = {
    name: 'wave',
    count: 2,
    users: ['UBLOCKED', 'UOTHER'],
    tooltip: 'Blocked and Other',
    reactions: [{ name: 'wave', count: 2, users: ['UBLOCKED', 'UOTHER'] }],
  };
  const next = filterReaction(original, blocked)!;
  assert.equal(next.count, 1);
  assert.deepEqual(next.users, ['UOTHER']);
  assert.equal(next.tooltip, undefined);
  assert.deepEqual(next.reactions[0].users, ['UOTHER']);
  assert.equal(filterReaction(next, blocked), next);
  assert.equal(original.count, 2);
  assert.equal(filterReaction({ name: 'wave', count: 1, users: ['UBLOCKED'] }, blocked), null);
  const allowed = [{ name: 'wave', count: 1, users: ['UOTHER'] }];
  assert.equal(filterReactions(allowed, blocked), allowed);
});

test('partial reactor lists preserve unknown reactors and do not invent identities', () => {
  const next = filterReaction({ count: 5, users: ['UBLOCKED', 'UOTHER'] }, blocked)!;
  assert.equal(next.count, 4);
  assert.deepEqual(next.users, ['UOTHER']);
  assert.deepEqual(filterReaction({ count: 4 }, blocked), { count: 4 });
});

test('removes forwards, shared files and structured mentions without changing the stored message', () => {
  const message = {
    user: 'UOTHER',
    text: 'Hi <@UBLOCKED|Old name> and <@UOTHER>',
    blocks: [
      {
        type: 'rich_text',
        elements: [
          {
            type: 'rich_text_section',
            elements: [
              { type: 'user', user_id: 'UBLOCKED' },
              { type: 'text', text: 'hello' },
              { type: 'user', user_id: 'UOTHER' },
            ],
          },
        ],
      },
    ],
    attachments: [
      { author_id: 'UBLOCKED', text: 'forward' },
      { author_id: 'UOTHER', text: 'keep' },
    ],
    files: [
      { user: 'UBLOCKED', id: 'F1' },
      { user: 'UOTHER', id: 'F2' },
    ],
  };
  const snapshot = structuredClone(message);
  const next = filterMessage(message, blocked);
  assert.equal(next.text, 'Hi  and <@UOTHER>');
  assert.equal(next.blocks[0].elements[0].elements.length, 2);
  assert.equal(next.attachments.length, 1);
  assert.equal(next.files.length, 1);
  assert.deepEqual(message, snapshot);
  assert.equal(filterMessage(next, blocked), next);
  assert.equal(filterContent({ text: 'unrelated' }, blocked).text, 'unrelated');
});

test('thread counts use known replies and preserve incomplete author lists', () => {
  const message = {
    reply_count: 3,
    reply_users_count: 2,
    reply_users: ['UBLOCKED', 'UOTHER'],
    latest_reply: '3',
    replies: [
      { user: 'UBLOCKED', ts: '1' },
      { user: 'UOTHER', ts: '2' },
      { user: 'UBLOCKED', ts: '3' },
    ],
  };
  const next = filterMessage(message, blocked);
  assert.equal(next.reply_count, 1);
  assert.deepEqual(next.reply_users, ['UOTHER']);
  assert.equal(next.latest_reply, '2');
  assert.equal(
    filterMessage({ reply_count: 8, reply_users_count: 1, reply_users: ['UBLOCKED'] }, blocked).reply_count,
    0,
  );
  assert.equal(
    filterMessage({ reply_count: 8, reply_users_count: 4, reply_users: ['UBLOCKED'] }, blocked).reply_count,
    8,
  );
});

test('thread counts subtract blocked replies loaded into the channel bucket', () => {
  const bucket = Object.create({
    '1': { ts: '1', user: 'UOTHER', reply_count: 3, reply_users: ['UBLOCKED', 'UOTHER'], latest_reply: '4' },
    '2': { ts: '2', thread_ts: '1', user: 'UBLOCKED' },
    '3': { ts: '3', thread_ts: '1', user: 'UOTHER' },
    '4': { ts: '4', thread_ts: '1', user: 'UBLOCKED' },
    '5': { ts: '5', thread_ts: '5', user: 'UOTHER' },
  });
  const threads = threadReplies(bucket);
  assert.deepEqual([...threads.keys()], ['1']);
  assert.equal(hasBlockedReplies(bucket['1'], blocked), true);
  assert.equal(hasBlockedReplies(bucket['5'], blocked), false);
  const next = filterMessage(bucket['1'], blocked, threads.get('1'));
  assert.equal(next.reply_count, 1);
  assert.equal(next.latest_reply, '3');
  assert.equal(filterMessage(next, blocked), next);
  const duplicate = filterMessage({ ...bucket['1'], replies: [bucket['2']] }, blocked, threads.get('1'));
  assert.equal(duplicate.reply_count, 1);
});

test('filters virtual history with inherited message keys and preserves pagination boundaries', () => {
  const messages = Object.create({ '1': { user: 'UBLOCKED' }, '2': { user: 'UOTHER' } });
  const history = { reachedEnd: true, slices: [{ timestamps: ['1', '2', '3'], start: '1', end: '3' }] };
  const next = filterHistory(history, messages, blocked);
  assert.deepEqual(next.slices![0], { timestamps: ['2', '3'], start: '1', end: '3' });
  assert.equal(next.reachedEnd, true);
  assert.deepEqual(history.slices[0].timestamps, ['1', '2', '3']);
  assert.equal(filterHistory(history, messages, new Set()), history);
  assert.equal(filterHistory(history, undefined, blocked), history);
});

test('activity checks the reacting person and message author, without hiding huddle invites', () => {
  const state = { messages: { C1: { '1': { user: 'UOTHER' }, '2': { user: 'UBLOCKED' } } } };
  assert.equal(
    hidesActivity(
      { type: 'message_reaction', channelId: 'C1', messageTs: '1', reactionUser: 'UBLOCKED' },
      state,
      blocked,
    ),
    true,
  );
  assert.equal(hidesActivity({ channelId: 'C1', messageTs: '2' }, state, blocked), true);
  assert.equal(hidesActivity({ type: 'huddle', userId: 'UBLOCKED' }, state, blocked), false);
  assert.equal(
    hidesActivity(
      { type: 'message_reaction', channelId: 'C1', messageTs: '1', reactionUser: 'UOTHER' },
      state,
      blocked,
    ),
    false,
  );
  assert.equal(blockedDm({ is_im: true, user: 'UBLOCKED' }, blocked), true);
  assert.equal(blockedDm({ is_mpim: true, user: 'UBLOCKED' }, blocked), false);
});

test('autocomplete filters local and deferred results while preserving metadata', async () => {
  const { filterMemberResults } = await import('./filter.ts');
  const local = Object.assign([{ item: { id: 'UBLOCKED' } }, { item: { id: 'UOTHER' } }], {
    query: 'u',
    promise: Promise.resolve([{ item: { id: 'UBLOCKED' } }, { item: { id: 'UREMOTE' } }]),
  });
  const next = filterMemberResults(local, () => blocked);
  assert.deepEqual(
    next.map((item: any) => item.item.id),
    ['UOTHER'],
  );
  assert.equal(next.query, 'u');
  assert.deepEqual(
    (await next.promise).map((item: any) => item.item.id),
    ['UREMOTE'],
  );
  assert.equal(local.length, 2);
  let active = true;
  const pending = filterMemberResults(local, () => (active ? blocked : new Set()));
  active = false;
  assert.equal((await pending.promise).length, 2, 'disabled plugin does not filter in-flight remote results');
});

test('grouped emoji counts remove multiple variants from the same blocked reactor', () => {
  const next = filterReaction(
    {
      count: 3,
      users: ['UBLOCKED', 'UOTHER'],
      reactions: [
        { name: 'wave', count: 1, users: ['UBLOCKED'] },
        { name: 'wave::skin-tone-2', count: 2, users: ['UBLOCKED', 'UOTHER'] },
      ],
    },
    blocked,
  )!;
  assert.equal(next.count, 1);
  assert.equal(next.reactions.length, 1);
  assert.equal(filterReaction(next, blocked), next);
});
