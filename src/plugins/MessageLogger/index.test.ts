import assert from 'node:assert/strict';
import { test } from 'node:test';
import { build } from 'esbuild';
import { ScopedStorage } from '../../app/api/storage.ts';

const bundle = await build({
  entryPoints: [new URL('./index.ts', import.meta.url).pathname],
  bundle: true,
  write: false,
  platform: 'node',
  format: 'esm',
});
const { default: MessageLogger } = await import(
  `data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0]!.text).toString('base64')}`
);
const data = 'data:image/png;base64,aGVsbG8=';
async function drain() {
  for (let i = 0; i < 40; i++) await Promise.resolve();
}

test('RTM deletes restore previews in the file slot after restart and remove them when accepted', async (t) => {
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'React');
  let contextImages: any[] = [];
  const React = {
    useContext: () => contextImages,
    createContext: () => ({ Provider: 'provider' }),
    createElement: (type: unknown, props: unknown, ...children: unknown[]) => ({ type, props, children }),
    useMemo: (fn: () => unknown) => fn(),
    useEffect: (fn: () => void) => fn(),
  };
  Object.defineProperty(globalThis, 'React', { configurable: true, value: React });
  t.after(() => {
    if (previous) Object.defineProperty(globalThis, 'React', previous);
    else Reflect.deleteProperty(globalThis, 'React');
  });
  const values = new Map<string, unknown>();
  const store = {
    async entries(prefix: string) {
      return new Map([...values].filter(([key]) => key.startsWith(prefix)));
    },
    async get(key: string, fallback: unknown) {
      return values.get(key) ?? fallback;
    },
    async set(key: string, value: unknown) {
      values.set(key, value);
      return true;
    },
    async delete(key: string) {
      return values.delete(key);
    },
  };
  function start(saveImages = true) {
    const events = new Map<string, (event: unknown) => void>();
    const patches = new Map<string, any>();
    const controller = new AbortController();
    const api = {
      storage: store,
      signal: controller.signal,
      react: React,
      rtm: { on: (name: string, callback: (event: unknown) => void) => events.set(name, callback) },
      messages: { injectMessages() {}, getRawMessage() {} },
      setStyle() {},
      patchComponent: (name: string, patch: unknown) => patches.set(name, patch),
      redux: {
        refresh() {},
        patchThunk() {},
        usePatchVersion: () => 0,
        getRawState: () => ({
          bootData: { user_id: 'ME' },
          files: {
            F1: { id: 'F1', title: 'Cat', mimetype: 'image/png', thumb_480: 'https://files.slack.com/cat.png' },
          },
        }),
      },
    };
    const plugin = new MessageLogger(api, {
      saveImages,
      retentionDays: 30,
      deletedStyle: 'red',
      ignoreSelf: false,
      ignoreAnchors: 'off',
    });
    plugin.log = () => {};
    plugin.start();
    plugin.images.download = async () => data;
    t.after(() => {
      controller.abort();
      plugin.stop();
    });
    return { plugin, events, patches, controller };
  }
  const message = {
    channel: 'C',
    ts: '1',
    user: 'U',
    text: 'cat',
    files: ['F1'],
  };
  const f = start();
  await drain();
  // History rows also prefetch images; an RTM arrival is not required.
  f.patches.get('MessageWrapper')(() => null)({ msg: message });
  await drain();
  assert.equal(values.size, 0);
  f.events.get('message_deleted')!({
    type: 'message',
    subtype: 'message_deleted',
    channel: 'C',
    deleted_ts: '1',
    previous_message: { ...message, files: undefined },
  });
  f.plugin.flush();
  await drain();
  assert.ok(values.has('entry:C:1'));
  assert.ok(values.has('images:C:1'));
  f.controller.abort();
  f.plugin.stop();
  const restarted = start();
  await drain();
  const row = restarted.patches.get('MessageWrapper')(() => null)({ msg: message });
  // The row contains only Slack's original body; no extra image below it.
  assert.equal(row.children[0].children.length, 1);
  contextImages = row.props.value;
  const Original = () => null;
  const renderFile = restarted.patches.get('MessageFile')(Original);
  const slot = renderFile({ file: { id: 'F1', mode: 'tombstone' }, className: 'c-file_gallery__message_file' });
  assert.match(slot.props.className, /c-file_gallery__message_file slick-ml-image/);
  assert.equal(slot.props.tabIndex, 0);
  const preview = slot.children[0];
  assert.equal(preview.type, 'img');
  assert.equal(preview.props.src, data);
  assert.equal(renderFile({ file: { id: 'PDF' } }).type, Original);
  const renderFiles = restarted.patches.get('MessageFiles')(Original);
  assert.equal(renderFiles({ msg: message }).children[1], null);
  const fallback = renderFiles({ msg: { ...message, files: undefined } }).children[1];
  assert.equal(fallback.props.className, 'slick-ml-images');
  // Existing archives without IDs still replace their sole file card.
  restarted.plugin.images.archived.set('C:1', [{ name: 'Cat', data }]);
  contextImages = restarted.patches.get('MessageWrapper')(Original)({ msg: message }).props.value;
  assert.equal(renderFile({ file: { id: 'F1' } }).children[0].props.src, data);
  const objectRow = restarted.patches.get('MessageWrapper')(Original)({
    msg: { ...message, files: [{ id: 'F1', mimetype: 'image/png' }] },
  });
  assert.deepEqual(objectRow.children[0].children[0].props.msg.files, ['F1']);
  restarted.plugin.acceptDelete(restarted.plugin.entries.get('C:1'));
  restarted.plugin.flush();
  await drain();
  assert.equal(values.size, 0);
});

test('edit exclusions match sender IDs across message payloads and leave deletes intact', async (t) => {
  const previousReact = Object.getOwnPropertyDescriptor(globalThis, 'React');
  Object.defineProperty(globalThis, 'React', {
    configurable: true,
    value: { createContext: () => ({}) },
  });
  t.after(() => {
    if (previousReact) Object.defineProperty(globalThis, 'React', previousReact);
    else Reflect.deleteProperty(globalThis, 'React');
  });
  const values = new Map<string, any>();
  const cached = new Map<string, any>();
  const config = {
    saveImages: false,
    retentionDays: 30,
    ignoreSelf: false,
    ignoreAnchors: 'off',
    ignoreEditsFrom: ' , A08GT3TM7A4, UIGNORED, BIGNORED, ',
  };
  const plugin = new MessageLogger(
    {
      storage: {
        async set(key: string, value: unknown) {
          values.set(key, value);
          return true;
        },
        async delete(key: string) {
          return values.delete(key);
        },
      },
      messages: { getRawMessage: (_channel: string, ts: string) => cached.get(ts) },
      redux: { getRawState: () => ({}), refresh() {} },
    },
    config,
  );
  t.after(() => plugin.stop());
  function edit(ts: string, before = {}, after = {}, event = {}) {
    plugin.record({
      type: 'message',
      subtype: 'message_changed',
      channel: 'C',
      previous_message: { ts, text: 'before', ...before },
      message: { ts, text: 'after', ...after },
      ...event,
    });
  }

  edit('app', {}, { app_id: 'A08GT3TM7A4' });
  edit('user', {}, { user: 'UIGNORED' });
  edit('bot', {}, { bot_id: 'BIGNORED' });
  edit('profile-app', {}, { bot_profile: { app_id: 'A08GT3TM7A4' } });
  edit('profile-user', {}, { bot_profile: { user_id: 'UIGNORED' } });
  edit('profile-bot', {}, { bot_profile: { id: 'BIGNORED' } });
  edit('previous', { app_id: 'A08GT3TM7A4' }, { user: 'UOTHER' });
  cached.set('cached', { app_id: 'A08GT3TM7A4' });
  edit('cached', {}, {}, { previous_message: undefined });
  edit('event', {}, {}, { user: 'UIGNORED' });
  plugin.flush();
  await drain();
  assert.equal(values.size, 0);

  edit('allowed', {}, { user: 'UOTHER', app_id: 'A08GT3TM7A4OTHER' });
  plugin.flush();
  await drain();
  assert.deepEqual(values.get('entry:C:allowed').edits, [{ oldText: 'before', newText: 'after' }]);

  config.ignoreEditsFrom = '';
  edit('app', { text: 'after' }, { text: 'again', app_id: 'A08GT3TM7A4' });
  plugin.flush();
  await drain();
  assert.equal(values.get('entry:C:app').edits.length, 1);
  config.ignoreEditsFrom = 'A08GT3TM7A4';
  edit('app', { text: 'again' }, { text: 'last', app_id: 'A08GT3TM7A4' });
  plugin.record({
    type: 'message',
    subtype: 'message_deleted',
    channel: 'C',
    deleted_ts: 'app',
    previous_message: { ts: 'app', text: 'last', app_id: 'A08GT3TM7A4' },
  });
  plugin.flush();
  await drain();
  assert.equal(values.get('entry:C:app').edits.length, 1);
  assert.equal(values.get('entry:C:app').deleted, true);
});

test('admin-hidden threads restore parent and replies as deletions, not edits', async (t) => {
  const previousReact = Object.getOwnPropertyDescriptor(globalThis, 'React');
  Object.defineProperty(globalThis, 'React', { configurable: true, value: { createContext: () => ({}) } });
  t.after(() => {
    if (previousReact) Object.defineProperty(globalThis, 'React', previousReact);
    else Reflect.deleteProperty(globalThis, 'React');
  });
  const values = new Map<string, any>();
  const config = {
    saveImages: false,
    retentionDays: 30,
    ignoreSelf: false,
    ignoreAnchors: 'off',
    ignoreEditsFrom: 'UREVOKEDU',
  };
  const plugin = new MessageLogger(
    {
      storage: {
        async set(key: string, value: unknown) {
          values.set(key, value);
          return true;
        },
        async delete(key: string) {
          return values.delete(key);
        },
      },
      messages: { getRawMessage() {} },
      redux: { getRawState: () => ({ bootData: { user_id: 'ME' } }), refresh() {} },
    },
    config,
  );
  t.after(() => plugin.stop());
  const originals = [
    { channel: 'C', ts: '1', user: 'U', text: 'parent', reply_count: 1 },
    { channel: 'C', ts: '2', user: 'U', text: 'reply', thread_ts: '1' },
  ];
  for (const original of originals) {
    plugin.remember(original);
    const event = {
      type: 'message',
      subtype: 'message_changed',
      channel: 'C',
      previous_message: original,
      message: {
        ts: original.ts,
        user: 'UREVOKEDU',
        subtype: 'thread_hidden',
        text: 'This thread has been removed by an admin.',
      },
    };
    plugin.record(event);
    plugin.record(event);
  }
  plugin.flush();
  await drain();
  for (const original of originals) {
    const entry = values.get(`entry:C:${original.ts}`);
    assert.equal(entry.deleted, true);
    assert.equal(entry.user, 'U');
    assert.equal(entry.edits, undefined);
    assert.deepEqual(entry.message, original);
  }
  assert.deepEqual(plugin.injectable(), originals);
  assert.deepEqual(plugin.loggedThread('C', '1'), originals);

  // Detection uses Slack's subtype, not localized notice text or the revoked user alone.
  plugin.record({
    type: 'message',
    subtype: 'message_changed',
    channel: 'C',
    previous_message: { ts: '3', user: 'U', text: 'before' },
    message: { ts: '3', user: 'U', text: 'This thread has been removed by an admin.' },
  });
  assert.equal(plugin.entries.get('C:3').deleted, undefined);
  config.ignoreSelf = true;
  plugin.record({
    type: 'message',
    subtype: 'message_changed',
    channel: 'C',
    previous_message: { ts: '4', user: 'ME', text: 'own message' },
    message: { ts: '4', user: 'UREVOKEDU', subtype: 'thread_hidden', text: 'removed' },
  });
  assert.equal(plugin.entries.has('C:4'), false);
  // Without previous_message, the recent RTM cache still supplies the original.
  plugin.remember({ channel: 'C', ts: '5', user: 'U', text: 'cached reply', thread_ts: '1' });
  plugin.record({
    type: 'message',
    subtype: 'message_changed',
    channel: 'C',
    message: { ts: '5', user: 'UREVOKEDU', subtype: 'thread_hidden', text: 'removed' },
  });
  assert.equal(plugin.entries.get('C:5').message.text, 'cached reply');
});

function loggerFixture(t: import('node:test').TestContext, storage?: ScopedStorage) {
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'React');
  const React = {
    createContext: () => ({ Provider: 'provider' }),
    createElement: (type: unknown, props: unknown, ...children: unknown[]) => ({ type, props, children }),
    useMemo: (fn: () => unknown) => fn(),
    useEffect: (fn: () => void) => fn(),
    useContext: (_context: unknown): any => null,
  };
  Object.defineProperty(globalThis, 'React', { configurable: true, value: React });
  const raw = new Map<string, any>();
  const values = new Map<string, any>();
  const patches = new Map<string, any>();
  const controller = new AbortController();
  const config = {
    saveImages: false,
    retentionDays: 30,
    ignoreSelf: true,
    ignoreAnchors: 'strict',
    ignoreEditsFrom: 'IGNORED',
  };
  const api = {
    signal: controller.signal,
    react: React,
    patchComponent: (name: string, patch: unknown) => patches.set(name, patch),
    messages: {
      getRawMessage: (_channel: string, ts: string) => raw.get(ts),
      getMessageBotId: (msg: any) => msg?.bot_id ?? msg?.bot_profile?.id,
    },
    redux: { getRawState: () => ({ bootData: { user_id: 'ME' } }), refresh() {}, usePatchVersion: () => 0 },
    storage: storage ?? {
      async entries(prefix: string) {
        return new Map([...values].filter(([key]) => key.startsWith(prefix)));
      },
      async get(key: string, fallback: unknown) {
        return values.get(key) ?? fallback;
      },
      async set(key: string, value: unknown) {
        values.set(key, value);
        return true;
      },
      async delete(key: string) {
        return values.delete(key);
      },
    },
  };
  const plugin = new MessageLogger(api, config);
  t.after(() => {
    plugin.stop();
    controller.abort();
    if (previous) Object.defineProperty(globalThis, 'React', previous);
    else Reflect.deleteProperty(globalThis, 'React');
  });
  const deletion = (previous_message: any, extra = {}) =>
    plugin.record({
      type: 'message',
      subtype: 'message_deleted',
      channel: 'C',
      deleted_ts: '1',
      previous_message,
      ...extra,
    });
  const edit = (message: any, previous_message: any) =>
    plugin.record({
      type: 'message',
      subtype: 'message_changed',
      channel: 'C',
      message,
      previous_message,
    });
  return { plugin, raw, values, deletion, edit, config, patches, React, controller, api };
}

function richMessage(body: string, extra = {}) {
  return {
    channel: 'C',
    ts: '1',
    user: 'U',
    text: 'get a better message logger lol',
    blocks: [
      { type: 'rich_text', elements: [{ type: 'rich_text_section', elements: [{ type: 'text', text: body }] }] },
    ],
    ...extra,
  };
}

test('delete preserves observed blocks over a swapped previous_message without displaying a notice', async (t) => {
  const f = loggerFixture(t);
  const original = richMessage('lmaoo');
  f.plugin.remember(original);
  original.blocks[0].elements[0].elements[0].text = 'tampered after arrival';
  f.deletion({
    ...richMessage('forged visible body'),
    ts: '1',
    channel: 'WRONG',
    user: 'ME',
    text: original.text,
    app_id: 'A',
    metadata: { event_type: 'anchor' },
  });
  const entry = f.plugin.entries.get('C:1');
  assert.equal(entry.deleted, true);
  assert.equal(entry.user, 'U');
  assert.equal(entry.evaded, true);
  assert.equal(entry.message.blocks[0].elements[0].elements[0].text, 'lmaoo');
  assert.equal(f.plugin.entries.has('WRONG:1'), false);
  f.plugin.patchRows();
  const row = f.plugin.renderRow(() => null, { msg: entry.message });
  f.React.useContext = () => row.props.value;
  const body = f.patches.get('Blocks')(() => null)({ msg: entry.message });
  assert.equal(body.children.length, 2, 'body contains only edit history and the original content');
  assert.equal(body.children[0], null, 'a recovered deletion does not add edit history');
  f.plugin.flush();
  await drain();
  assert.equal(f.values.get('entry:C:1').evaded, true);
});

test('oversized hidden URLs cannot replace the visible body when retention drops blocks', (t) => {
  const f = loggerFixture(t);
  const message = richMessage('lmaoo');
  message.blocks[0].elements[0].elements.unshift({
    type: 'link',
    text: '\u2060',
    url: 'https://example.com/' + '\u0001'.repeat(40000),
  } as any);
  f.plugin.remember(message);
  f.deletion({ ts: '1', text: message.text });
  const entry = f.plugin.entries.get('C:1');
  assert.equal(entry.message.blocks, undefined);
  assert.equal(entry.message.text, '\u2060lmaoo');
  assert.equal(entry.evaded, true);
});

test('block-only edits use local history, advance the cache, and survive deletion', (t) => {
  const f = loggerFixture(t);
  f.plugin.remember(richMessage('first'));
  const second = richMessage('second');
  f.edit(second, { ts: '1', user: 'IGNORED', text: second.text });
  assert.deepEqual(f.plugin.entries.get('C:1').edits, [{ oldText: 'first', newText: 'second' }]);
  f.edit(richMessage('third'), second);
  const entry = f.plugin.entries.get('C:1');
  assert.deepEqual(entry.edits, [
    { oldText: 'first', newText: 'second' },
    { oldText: 'second', newText: 'third' },
  ]);
  f.plugin.recent.clear();
  f.deletion({ ts: '1', text: 'taunt' });
  assert.equal(f.plugin.entries.get('C:1').message.blocks[0].elements[0].elements[0].text, 'third');
});

test('history rows and raw Redux messages protect deletes even without an RTM arrival', (t) => {
  const f = loggerFixture(t);
  f.plugin.renderRow(() => null, { msg: richMessage('history') });
  f.deletion({ ts: '1', text: 'fake' });
  assert.equal(f.plugin.entries.get('C:1').message.blocks[0].elements[0].elements[0].text, 'history');
  f.raw.set('2', { channel: 'C', ts: '2', user: 'U', text: 'raw original' });
  f.deletion({ ts: '2', text: 'fake' }, { deleted_ts: '2' });
  assert.equal(f.plugin.entries.get('C:2').message.text, 'raw original');
  // An unseen delete can still use the supplied previous message, without alleging evasion.
  f.deletion({ ts: '3', text: 'unseen' }, { deleted_ts: '3' });
  assert.equal(f.plugin.entries.get('C:3').message.text, 'unseen');
  assert.equal(f.plugin.entries.get('C:3').evaded, undefined);
});

test('strict anchor mode skips history-loaded bot anchors and pinned bot messages only', (t) => {
  const f = loggerFixture(t);
  const bot = { user: 'UBOT', bot_id: 'B', bot_profile: { id: 'B', app_id: 'A' } };
  f.raw.set('1', { channel: 'C', ts: '1', ...bot, text: 'anchor', metadata: { event_type: 'anchor_poll' } });
  f.deletion({ ts: '1', text: 'anchor' }, { deleted_ts: '1' });
  f.raw.set('2', { channel: 'C', ts: '2', ...bot, text: 'pinned', pinned_to: ['C'] });
  f.deletion({ ts: '2', text: 'pinned' }, { deleted_ts: '2' });
  f.raw.set('3', { channel: 'C', ts: '3', ...bot, text: 'unpinned bot' });
  f.deletion({ ts: '3', text: 'unpinned bot' }, { deleted_ts: '3' });
  f.raw.set('4', { channel: 'C', ts: '4', user: 'U', text: 'pinned human', pinned_to: ['C'] });
  f.deletion({ ts: '4', text: 'pinned human' }, { deleted_ts: '4' });
  assert.deepEqual([...f.plugin.entries.keys()].toSorted(), ['C:3', 'C:4']);
});

test('legitimate fallback differences, repeated edits, and different revisions do not allege evasion', (t) => {
  const f = loggerFixture(t);
  const first = richMessage('first');
  const second = richMessage('second');
  f.plugin.remember(first);
  f.edit(second, first);
  f.edit(second, first);
  assert.equal(f.plugin.entries.get('C:1').evaded, undefined);
  assert.equal(f.plugin.entries.get('C:1').edits.length, 1);
  f.deletion(second);
  assert.equal(f.plugin.entries.get('C:1').evaded, undefined);
  assert.equal(
    f.plugin.renderRow(() => null, { msg: f.plugin.entries.get('C:1').message }).children[0].children[0].children
      .length,
    1,
  );
  f.plugin.remember({ ts: '2', channel: 'C', text: 'older revision' });
  f.deletion({ ts: '2', text: 'newer revision', edited: { ts: '3' } }, { deleted_ts: '2' });
  assert.equal(f.plugin.entries.get('C:2').evaded, undefined);
});

test('ignored edits still update the observed body for subsequent deletes', (t) => {
  const f = loggerFixture(t);
  const first = richMessage('first', { app_id: 'IGNORED' });
  const second = richMessage('second', { app_id: 'IGNORED' });
  f.plugin.remember(first);
  f.edit(second, first);
  assert.equal(f.plugin.entries.size, 0);
  f.deletion({ ts: '1', text: 'fake' });
  assert.equal(f.plugin.entries.get('C:1').message.blocks[0].elements[0].elements[0].text, 'second');
});

test('padded deletion with unchanged previous blocks is flagged, including when previous_message is absent', (t) => {
  const f = loggerFixture(t);
  for (const ts of ['1', '2']) {
    const message = richMessage('original visible body', { ts });
    message.blocks[0].elements[0].elements.unshift({ type: 'link', text: '\u2060', url: '\u0001'.repeat(5776) } as any);
    f.plugin.remember(message);
    assert.equal(f.plugin.recent.get(`C:${ts}`).blocks, undefined, 'retention removed the hidden padding');
    f.deletion(ts === '1' ? message : undefined, { deleted_ts: ts });
    const entry = f.plugin.entries.get(`C:${ts}`);
    assert.equal(entry.evaded, true);
    assert.equal(entry.message.text, '\u2060original visible body');
  }
});

test('a later delete payload adds evasion evidence without overwriting the preserved body', (t) => {
  const f = loggerFixture(t);
  f.plugin.remember({ channel: 'C', ts: '1', user: 'U', text: 'saved original' });
  f.deletion(undefined);
  assert.equal(f.plugin.entries.get('C:1').evaded, undefined);
  const padded = richMessage('visible body');
  padded.blocks[0].elements[0].elements.unshift({ type: 'link', text: '\u2060', url: '\u0001'.repeat(5776) } as any);
  f.deletion(padded);
  assert.equal(f.plugin.entries.get('C:1').evaded, true);
  assert.equal(f.plugin.entries.get('C:1').message.text, 'saved original');
});

test('/hh to /hj is a legitimate edit with full or incomplete previous payloads', (t) => {
  for (const previousKind of ['full', 'text-only', 'metadata-only', 'absent']) {
    const f = loggerFixture(t);
    const first = richMessage('/hh', { text: '/hh' });
    const second = richMessage('/hj', { text: '/hj', edited: { ts: '2' } });
    f.plugin.remember(first);
    const previous =
      previousKind === 'full'
        ? first
        : previousKind === 'text-only'
          ? { ts: '1', text: '/hh' }
          : previousKind === 'metadata-only'
            ? { ts: '1', user: 'U' }
            : undefined;
    f.edit(second, previous);
    f.edit(second, previous);
    const entry = f.plugin.entries.get('C:1');
    assert.deepEqual(entry.edits, [{ oldText: '/hh', newText: '/hj' }], previousKind);
    assert.equal(entry.evaded, undefined, previousKind);
    f.deletion(second);
    assert.equal(f.plugin.entries.get('C:1').evaded, undefined, previousKind);
  }
});

test('omitted blocks and different fallback rendering are not evidence of evasion', (t) => {
  const f = loggerFixture(t);
  const first = richMessage('/hh', { text: 'fallback /hh' });
  f.plugin.remember(first);
  f.edit(richMessage('/hj', { text: 'fallback /hj', edited: { ts: '2' } }), { ts: '1', text: first.text });
  assert.equal(f.plugin.entries.get('C:1').evaded, undefined);
  assert.deepEqual(f.plugin.entries.get('C:1').edits, [{ oldText: '/hh', newText: '/hj' }]);
});

test('metadata-only updates preserve the observed body and do not invent empty edits', (t) => {
  const f = loggerFixture(t);
  const first = richMessage('/hh', { text: '/hh' });
  f.plugin.remember(first);
  f.edit({ ts: '1', user: 'U', reply_count: 1 }, { ts: '1', user: 'U' });
  f.edit({ ts: '1', text: undefined, blocks: undefined }, undefined);
  assert.equal(f.plugin.entries.size, 0);
  f.edit(richMessage('/hj', { text: '/hj', edited: { ts: '2' } }), first);
  assert.deepEqual(f.plugin.entries.get('C:1').edits, [{ oldText: '/hh', newText: '/hj' }]);
  assert.equal(f.plugin.entries.get('C:1').evaded, undefined);
});

test('empty text remains comparable evidence, while missing revisions are not', (t) => {
  const f = loggerFixture(t);
  f.plugin.remember({ channel: 'C', ts: '1', text: 'observed' });
  f.deletion({ ts: '1', text: '' });
  assert.equal(f.plugin.entries.get('C:1').evaded, true);
  assert.equal(f.plugin.evaded({ text: 'one' }, { text: 'two' }), false);
  assert.equal(f.plugin.evaded({ ts: 'bad', text: 'one' }, { ts: 'bad', text: 'two' }), false);
  assert.equal(
    f.plugin.evaded({ ts: '10000000000.000001', text: 'one' }, { ts: '10000000000.000002', text: 'two' }),
    false,
  );
});

test('same-revision altered text and altered blocks still flag evasion on edits', (t) => {
  for (const original of [{ channel: 'C', ts: '1', text: '/hh' }, richMessage('/hh')]) {
    const f = loggerFixture(t);
    f.plugin.remember(original);
    const forged = 'blocks' in original ? richMessage('forged') : { ts: '1', text: 'forged' };
    f.edit({ ts: '1', text: '/hj', edited: { ts: '2' } }, forged);
    assert.equal(f.plugin.entries.get('C:1').evaded, true);
    assert.equal(f.plugin.entries.get('C:1').edits[0].oldText, '/hh');
  }
});

test('a delete omitting blocks preserves the observed body without alleging evasion', (t) => {
  const f = loggerFixture(t);
  const original = richMessage('visible body');
  f.plugin.remember(original);
  f.deletion({ ts: '1', text: original.text });
  assert.equal(f.plugin.entries.get('C:1').evaded, undefined);
  assert.deepEqual(f.plugin.entries.get('C:1').message, original);
});

test('an already advanced Redux cache does not turn a normal edit into evasion', (t) => {
  const f = loggerFixture(t);
  const first = richMessage('/hh', { text: '/hh' });
  const second = richMessage('/hj', { text: '/hj', edited: { ts: '2' } });
  f.raw.set('1', second);
  f.edit(second, first);
  assert.equal(f.plugin.entries.get('C:1')?.evaded, undefined);
  f.deletion(second);
  assert.equal(f.plugin.entries.get('C:1').evaded, undefined);
  assert.equal(f.plugin.entries.get('C:1').message.text, '/hj');
});

test('own edits log the previous body after Slack optimistically updated the row', (t) => {
  const f = loggerFixture(t);
  f.config.ignoreSelf = false;
  const first = richMessage('first', { user: 'ME', text: 'first' });
  const second = richMessage('second', { user: 'ME', text: 'second', edited: { ts: '2' } });
  f.plugin.remember(first);
  f.plugin.renderRow(() => null, { msg: richMessage('second', { user: 'ME', text: 'first' }) });
  f.edit(second, first);
  assert.deepEqual(f.plugin.entries.get('C:1').edits, [{ oldText: 'first', newText: 'second' }]);
  assert.equal(f.plugin.entries.get('C:1').evaded, undefined);
  f.plugin.renderRow(() => null, { msg: richMessage('third', { user: 'ME', text: 'second' }) });
  f.edit(richMessage('third', { user: 'ME', text: 'third', edited: { ts: '3' } }), second);
  assert.deepEqual(f.plugin.entries.get('C:1').edits, [
    { oldText: 'first', newText: 'second' },
    { oldText: 'second', newText: 'third' },
  ]);
  assert.equal(f.plugin.entries.get('C:1').evaded, undefined);
});

test('channel-scoped row misses avoid scanning the canonical archive', (t) => {
  const f = loggerFixture(t);
  for (let i = 0; i < 1000; i++) f.plugin.setEntry(`C:${i}`, { channel: 'C', ts: `${i}`, at: Date.now() });
  const wanted = f.plugin.entries.get('C:1');
  f.plugin.entries.values = () => {
    throw new Error('Known-channel rows must not scan canonical entries');
  };
  assert.equal(f.plugin.entryFor({ channel: 'C', ts: '1' }), wanted);
  assert.equal(f.plugin.entryFor({ channel: 'C', ts: 'missing' }), undefined);
  assert.equal(f.plugin.entryFor({ ts: 'missing' }, 'C'), undefined);
  assert.equal(f.plugin.legacyEntries.size, 0);
});

test('legacy-key and context-free lookups preserve channel matching and ambiguity rules', (t) => {
  const f = loggerFixture(t);
  const legacy = { channel: 'C', ts: '1', at: Date.now() };
  f.plugin.setEntry('old-storage-key', legacy);
  assert.equal(f.plugin.entryFor({ ts: '1' }), legacy);
  assert.equal(f.plugin.entryFor({ ts: '1' }, 'C'), legacy);
  assert.equal(f.plugin.entryFor({ channel: 'OTHER', ts: '1' }, 'C'), undefined);
  const unknownChannel = { channel: '', ts: '2', at: Date.now() };
  f.plugin.setEntry(':2', unknownChannel);
  assert.equal(f.plugin.entryFor({ channel: 'C', ts: '2' }), unknownChannel);
  f.plugin.setEntry('another-old-key', { channel: 'C', ts: '2', at: Date.now() });
  assert.equal(f.plugin.entryFor({ channel: 'C', ts: '2' }), undefined);
  assert.equal(f.plugin.entryFor({ ts: '2' }), undefined);
  const canonical = { channel: 'C', ts: '2', at: Date.now() };
  f.plugin.setEntry('C:2', canonical);
  assert.equal(
    f.plugin.entryFor({ channel: 'C', ts: '2' }),
    canonical,
    'an exact key still wins over fallback ambiguity',
  );
  assert.equal(f.plugin.entryFor({ channel: 'C', ts: 2 }), undefined);
});

test('legacy lookup bookkeeping follows replacement, expiry, dismissal and restore', async (t) => {
  const f = loggerFixture(t);
  const old = { channel: '', ts: '1', at: Date.now() };
  f.plugin.setEntry('C:1', old);
  assert.equal(f.plugin.legacyEntries.size, 1);
  const canonical = { channel: 'C', ts: '1', at: Date.now(), edits: [{ oldText: 'a', newText: 'b' }] };
  f.plugin.setEntry('C:1', canonical);
  assert.equal(f.plugin.legacyEntries.size, 0);
  f.plugin.hideEdits(canonical);
  assert.equal(f.plugin.entryFor({ channel: 'C', ts: '1' }), undefined);
  f.plugin.setEntry('old-storage-key', { ...old, at: 1 });
  f.plugin.cap();
  assert.equal(f.plugin.legacyEntries.size, 0);
  assert.equal(f.plugin.entryFor({ ts: '1' }), undefined);
  f.plugin.flush();
  await f.plugin.writes;
  const restored = { channel: 'C', ts: '3', at: Date.now(), deleted: true };
  f.values.set('entry:archived-key', restored);
  f.values.set('entry::4', { channel: '', ts: '4', at: Date.now() });
  f.plugin.log = () => {};
  await f.plugin.restore();
  assert.equal(f.plugin.entryFor({ channel: 'C', ts: '3' }), restored);
  assert.equal(f.plugin.entryFor({ channel: 'C', ts: '4' }), f.values.get('entry::4'));
  assert.equal(f.plugin.legacyEntries.size, 2);
  assert.ok(f.values.has('entry:archived-key'), 'restoring does not rewrite historical storage keys');
  f.plugin.forget('archived-key');
  assert.equal(f.plugin.entryFor({ channel: 'C', ts: '3' }), undefined);
  assert.equal(f.plugin.legacyEntries.size, 1);
});

function pausedRestoreFixture(t: import('node:test').TestContext) {
  const files = new Map<string, string>();
  const at = Date.now();
  files.set(
    'entry:C:1',
    JSON.stringify({
      channel: 'C',
      ts: '1',
      at,
      message: { channel: 'C', ts: '1', user: 'U', text: 'stored' },
      edits: [{ oldText: 'original', newText: 'stored' }],
    }),
  );
  files.set('entry:historical-key', JSON.stringify({ channel: 'D', ts: '2', at }));
  for (let i = 0; i < 63; i++) files.set(`entry:Z:${i}`, JSON.stringify({ channel: 'Z', ts: `${i}`, at }));
  let mutations = 0;
  const storage = new ScopedStorage({
    list: async () => [...files.keys()],
    read: async (key) => files.get(key) ?? null,
    readAll: async (prefix = '') => Object.fromEntries([...files].filter(([key]) => key.startsWith(prefix))),
    write: async (key, value) => {
      mutations++;
      files.set(key, value);
      return true;
    },
    delete: async (key) => {
      mutations++;
      return files.delete(key);
    },
    clear: async () => {
      mutations++;
      files.clear();
      return true;
    },
  });
  const f = loggerFixture(t, storage);
  f.plugin.log = () => {};
  const pending: (() => void)[] = [];
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'scheduler');
  const scheduler = { yield: () => new Promise<void>((resolve) => pending.push(resolve)) };
  Object.defineProperty(globalThis, 'scheduler', { configurable: true, value: scheduler });
  t.after(() => {
    if (descriptor) Object.defineProperty(globalThis, 'scheduler', descriptor);
    else Reflect.deleteProperty(globalThis, 'scheduler');
  });
  let now = 0;
  t.mock.method(performance, 'now', () => (now += 10));
  return { ...f, files, pending, mutations: () => mutations };
}

test('live edits remain authoritative when archive parsing pauses before legacy indexing', async (t) => {
  const f = pausedRestoreFixture(t);
  const restoring = f.plugin.restore();
  await drain();
  assert.equal(f.pending.length, 1, 'the actual storage parser paused after 64 records');
  assert.equal(f.plugin.entries.size, 0, 'partially parsed records remain outside the live archive');
  f.edit({ channel: 'C', ts: '1', user: 'U', text: 'live' }, { channel: 'C', ts: '1', user: 'U', text: 'stored' });
  assert.equal(f.plugin.entries.get('C:1').message.text, 'live');
  f.pending.shift()!();
  await restoring;
  await f.plugin.writes;

  const merged = f.plugin.entries.get('C:1');
  assert.equal(merged.message.text, 'live');
  assert.deepEqual(merged.edits, [
    { oldText: 'original', newText: 'stored' },
    { oldText: 'stored', newText: 'live' },
  ]);
  assert.equal(f.plugin.entryFor({ channel: 'C', ts: '1' }), merged);
  assert.equal(f.plugin.entries.size, 65);
  assert.equal(f.plugin.legacyEntries.size, 1);
  assert.equal(f.plugin.legacyEntries.get('historical-key'), f.plugin.entries.get('historical-key'));
  assert.equal(f.plugin.entryFor({ channel: 'D', ts: '2' }), f.plugin.entries.get('historical-key'));
  assert.equal(JSON.parse(f.files.get('entry:C:1')!).message.text, 'live');
  assert.equal(f.pending.length, 0);
});

test('scope abort during archive parsing prevents restore mutations and index updates', async (t) => {
  const f = pausedRestoreFixture(t);
  const existing = { channel: 'LIVE', ts: '99', at: Date.now() };
  f.plugin.setEntry('active-legacy', existing);
  let refreshes = 0;
  t.mock.method(f.api.redux, 'refresh', () => refreshes++);
  const restoring = f.plugin.restore();
  await drain();
  assert.equal(f.pending.length, 1);
  f.controller.abort();
  f.pending.shift()!();
  await restoring;
  await f.plugin.writes;

  assert.deepEqual([...f.plugin.entries], [['active-legacy', existing]]);
  assert.deepEqual([...f.plugin.legacyEntries], [['active-legacy', existing]]);
  assert.equal(f.plugin.dirty.size, 0);
  assert.equal(f.mutations(), 0);
  assert.equal(refreshes, 0);
  assert.equal(f.pending.length, 0);
  assert.equal(f.plugin.restoreDismissals, null);
});

for (const action of ['hideEdits', 'acceptDelete', 'expire'] as const) {
  test(`${action} during archive parsing stays dismissed after its deletion is flushed`, async (t) => {
    const f = pausedRestoreFixture(t);
    const restoring = f.plugin.restore();
    await drain();
    assert.equal(f.pending.length, 1);
    f.edit({ channel: 'C', ts: '1', user: 'U', text: 'live' }, { channel: 'C', ts: '1', user: 'U', text: 'stored' });
    if (action === 'acceptDelete') f.deletion({ channel: 'C', ts: '1', user: 'U', text: 'live' });
    const live = f.plugin.entries.get('C:1');
    if (action === 'expire') {
      live.at = Date.now() - 31 * 24 * 60 * 60 * 1000;
      assert.equal(f.plugin.cap(), true);
    } else f.plugin[action](live);
    f.plugin.flush();
    await f.plugin.writes;
    assert.equal(f.files.has('entry:C:1'), false);
    f.pending.shift()!();
    await restoring;
    await f.plugin.writes;
    assert.equal(f.plugin.entries.has('C:1'), false);
    assert.equal(f.files.has('entry:C:1'), false);
    assert.equal(f.plugin.restoreDismissals, null, 'dismissal tracking is released after the load');
  });
}

test('hiding edits on a deleted message during parsing preserves the deletion without old edits', async (t) => {
  const f = pausedRestoreFixture(t);
  const restoring = f.plugin.restore();
  await drain();
  f.edit({ channel: 'C', ts: '1', user: 'U', text: 'live' }, { channel: 'C', ts: '1', user: 'U', text: 'stored' });
  f.deletion({ channel: 'C', ts: '1', user: 'U', text: 'live' });
  f.plugin.hideEdits(f.plugin.entries.get('C:1'));
  f.plugin.flush();
  await f.plugin.writes;
  f.pending.shift()!();
  await restoring;
  await f.plugin.writes;
  assert.equal(f.plugin.entries.get('C:1').deleted, true);
  assert.equal(f.plugin.entries.get('C:1').edits, undefined);
  assert.equal(JSON.parse(f.files.get('entry:C:1')!).edits, undefined);
});

test('new edits after a dismissal during parsing survive without resurrecting older history', async (t) => {
  const f = pausedRestoreFixture(t);
  const restoring = f.plugin.restore();
  await drain();
  f.edit({ channel: 'C', ts: '1', user: 'U', text: 'live' }, { channel: 'C', ts: '1', user: 'U', text: 'stored' });
  f.plugin.hideEdits(f.plugin.entries.get('C:1'));
  f.plugin.flush();
  await f.plugin.writes;
  f.edit({ channel: 'C', ts: '1', user: 'U', text: 'newer' }, { channel: 'C', ts: '1', user: 'U', text: 'live' });
  f.pending.shift()!();
  await restoring;
  await f.plugin.writes;
  const edits = [{ oldText: 'live', newText: 'newer' }];
  assert.deepEqual(f.plugin.entries.get('C:1').edits, edits);
  assert.deepEqual(JSON.parse(f.files.get('entry:C:1')!).edits, edits);
});
