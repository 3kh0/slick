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
  edit('app', {}, { app_id: 'A08GT3TM7A4' });
  plugin.flush();
  await drain();
  assert.equal(values.get('entry:C:app').edits.length, 1);
  config.ignoreEditsFrom = 'A08GT3TM7A4';
  edit('app', { text: 'after' }, { text: 'again', app_id: 'A08GT3TM7A4' });
  plugin.record({
    type: 'message',
    subtype: 'message_deleted',
    channel: 'C',
    deleted_ts: 'app',
    previous_message: { ts: 'app', text: 'again', app_id: 'A08GT3TM7A4' },
  });
  plugin.flush();
  await drain();
  assert.equal(values.get('entry:C:app').edits.length, 1);
  assert.equal(values.get('entry:C:app').deleted, true);
});
