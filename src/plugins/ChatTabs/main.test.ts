import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { test } from 'node:test';
import type { MainCtx } from '../../shared/main.ts';
import plugin from './main.ts';
import { isCloseTabInput } from './shortcut.ts';

const key = { type: 'keyDown', key: 'w', meta: true, control: false, shift: false, alt: false } as Electron.Input;

test('close-tab shortcut accepts the platform modifier and ignores unrelated shortcuts', () => {
  assert.equal(isCloseTabInput(key, 'darwin'), true);
  assert.equal(isCloseTabInput(key, 'linux'), false);
  assert.equal(isCloseTabInput({ ...key, meta: false, control: true }, 'win32'), true);
  for (const change of [{ shift: true }, { alt: true }, { control: true }, { key: 'q' }, { type: 'keyUp' as const }])
    assert.equal(isCloseTabInput({ ...key, ...change }, 'darwin'), false);
});

test('native interception targets only the registered renderer and cleans up on disable or navigation', () => {
  const contents = Object.assign(new EventEmitter(), {
    getURL: () => 'https://app.slack.com/client/T1/C1',
  }) as unknown as Electron.WebContents;
  const other = Object.assign(new EventEmitter(), {
    getURL: () => 'https://app.slack.com/client/T1/C2',
  }) as unknown as Electron.WebContents;
  const calls: unknown[] = [];
  const ctx = { emitTo: (target: unknown, event: string) => calls.push([target, event]) } as unknown as MainCtx;
  const dispose = plugin.ready!() as () => void;
  let prevented = 0;
  const event = { preventDefault: () => prevented++ };
  const input = { ...key, meta: process.platform === 'darwin', control: process.platform !== 'darwin' };
  plugin.rpc.closeShortcut(ctx, [true], contents);
  plugin.rpc.closeShortcut(ctx, [true], contents);
  assert.equal(contents.listenerCount('before-input-event'), 1);
  other.emit('before-input-event', event, input);
  assert.equal(prevented, 0);
  contents.emit('before-input-event', event, input);
  assert.equal(prevented, 1);
  assert.deepEqual(calls, [[contents, 'close-tab']]);
  contents.emit('before-input-event', event, { ...input, isAutoRepeat: true });
  assert.equal(prevented, 2);
  assert.equal(calls.length, 1);
  contents.emit('did-start-navigation', {}, '', false, true);
  assert.equal(contents.listenerCount('before-input-event'), 0);
  plugin.rpc.closeShortcut(ctx, [true], contents);
  plugin.rpc.closeShortcut(ctx, [false], contents);
  assert.equal(contents.listenerCount('before-input-event'), 0);
  plugin.rpc.closeShortcut(ctx, [true], contents);
  dispose();
  assert.equal(contents.listenerCount('before-input-event'), 0);
});
