import assert from 'node:assert/strict';
import { test } from 'node:test';
import { build } from 'esbuild';

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

function loggerFixture(t: import('node:test').TestContext) {
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
  const config = {
    saveImages: false,
    retentionDays: 30,
    ignoreSelf: true,
    ignoreAnchors: 'strict',
    ignoreEditsFrom: 'IGNORED',
  };
  const api = {
    react: React,
    patchComponent: (name: string, patch: unknown) => patches.set(name, patch),
    messages: { getRawMessage: (_channel: string, ts: string) => raw.get(ts) },
    redux: { getRawState: () => ({ bootData: { user_id: 'ME' } }), refresh() {}, usePatchVersion: () => 0 },
    storage: {
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
  return { plugin, raw, values, deletion, edit, config, patches, React };
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

test('delete preserves observed blocks over a swapped previous_message and displays the evasion notice', async (t) => {
  const f = loggerFixture(t);
  const original = richMessage('lmaoo');
  f.plugin.remember(original);
  original.blocks[0].elements[0].elements[0].text = 'tampered after arrival';
  f.deletion({
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
  const notice = body.children[2];
  assert.equal(row.children[0].children[0].children.length, 1, 'notice belongs inside the body, not beside the row');
  assert.equal(notice.props.className, 'slick-ml-evasion');
  assert.equal(notice.children[0], 'this user is trying to evade the message logger');
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
