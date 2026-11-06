import assert from 'node:assert/strict';
import { test } from 'node:test';
import { build } from 'esbuild';
import type { SlackMessage } from './messages.ts';

const bundle = await build({
  stdin: {
    contents: `export {messagesReady} from './messages.ts';export {fixture} from './redux.ts';`,
    resolveDir: new URL('.', import.meta.url).pathname,
    loader: 'ts',
  },
  bundle: true,
  write: false,
  format: 'esm',
  platform: 'node',
  plugins: [
    {
      name: 'message-hook-dependencies',
      setup(bundler) {
        bundler.onResolve({ filter: /^\.\/redux\.ts$/ }, () => ({ path: 'redux', namespace: 'fixture' }));
        bundler.onResolve({ filter: /^\.\/webpack\.ts$/ }, () => ({ path: 'webpack', namespace: 'fixture' }));
        bundler.onLoad({ filter: /.*/, namespace: 'fixture' }, ({ path }) => ({
          loader: 'js',
          contents:
            path === 'redux'
              ? `
                export const fixture = {state: undefined, rawState: undefined, selectors: []};
                export const getRawState = () => fixture.rawState;
                export const reduxReady = Promise.resolve({useReduxState(read) {
                  fixture.selectors.push(read);
                  return fixture.state ? read(fixture.state) : undefined;
                }});
                export const getPatchVersion = () => 0;
                export const mapEntries = () => {};
                export const patchSlice = () => {};
              `
              : 'export const waitForExport = () => new Promise(() => {});',
        }));
      },
    },
  ],
});
const { messagesReady, fixture } = await import(
  `data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0]!.text).toString('base64')}`
);
const { useMessageBot } = await messagesReady;

function render(msg: SlackMessage | undefined) {
  fixture.selectors = [];
  const value = useMessageBot(msg);
  assert.equal(fixture.selectors.length, 1, 'bot selection uses one Redux subscription');
  return { value, snapshot: fixture.selectors[0] as (state: any) => unknown };
}

test('useMessageBot keeps raw-message, stored-bot and inline-profile precedence across channel changes', () => {
  const rendered = { channel: 'CONE', ts: '1', user: 'UPERSON', slick_bot_id: 'BRENDERED' };
  const first = { id: 'BFIRST', name: 'First' };
  const second = { id: 'BSECOND', name: 'Second' };
  const profile = { id: 'BFIRST', name: 'Inline' };
  fixture.state = { bots: { BFIRST: first, BSECOND: second }, messages: { CONE: { '1': rendered } } };
  fixture.rawState = {
    messages: {
      CONE: { '1': { channel: 'CONE', ts: '1', bot_id: first.id, bot_profile: profile } },
      CTWO: { '1': { channel: 'CTWO', ts: '1', bot_id: second.id } },
    },
  };
  assert.equal(render(rendered).value, first);
  assert.equal(render({ ...rendered, channel: 'CTWO' }).value, second);
  fixture.state = { ...fixture.state, bots: { BSECOND: second } };
  assert.equal(render(rendered).value, profile);
  fixture.rawState = { messages: {} };
  assert.deepEqual(render(rendered).value, { id: 'BRENDERED' });
});

test('useMessageBot snapshots stay stable and atomically observe bot changes, removal and profile replacement', () => {
  const msg = { channel: 'CONE', ts: '1' };
  const first = { id: 'BFIRST', name: 'First' };
  const second = { id: 'BSECOND', name: 'Second' };
  fixture.state = { bots: { BFIRST: first, BSECOND: second } };
  fixture.rawState = { messages: { CONE: { '1': { ...msg, bot_id: first.id } } } };
  const { snapshot } = render(msg);
  assert.equal(snapshot(fixture.state), first);
  assert.equal(snapshot({ ...fixture.state, unrelated: true }), first);
  fixture.rawState = { messages: { CONE: { '1': { ...msg, bot_id: second.id } } } };
  assert.equal(snapshot(fixture.state), second, 'a notification selects the new ID and bot together');
  fixture.state = { bots: {} };
  assert.equal(snapshot(fixture.state), second.id);
  assert.equal(snapshot(fixture.state), snapshot(fixture.state), 'missing bot snapshots are stable primitives');
  assert.deepEqual(render(msg).value, { id: second.id });
  const profile = { id: second.id, name: 'Inline' };
  fixture.rawState = { messages: { CONE: { '1': { ...msg, bot_profile: profile } } } };
  assert.equal(snapshot(fixture.state), profile);
  const changed = { ...profile, name: 'Updated inline' };
  fixture.rawState = { messages: { CONE: { '1': { ...msg, bot_profile: changed } } } };
  assert.equal(snapshot(fixture.state), changed, 'profile changes are observed even when the ID is unchanged');
  fixture.rawState = { messages: { CONE: { '1': msg } } };
  assert.equal(snapshot(fixture.state), undefined);
});

test('useMessageBot handles absent stores and messages without creating changing fallback snapshots', () => {
  fixture.state = undefined;
  fixture.rawState = undefined;
  assert.equal(render({ bot_id: 'BFIRST' }).value, undefined);
  fixture.state = {};
  assert.equal(render(undefined).value, undefined);
  assert.equal(render({ user: 'UPERSON' }).value, undefined);
  const { value, snapshot } = render({ bot_id: 'BFIRST' });
  assert.deepEqual(value, { id: 'BFIRST' });
  assert.equal(snapshot({}), 'BFIRST');
  assert.equal(snapshot({}), snapshot({}));
});
