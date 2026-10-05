import assert from 'node:assert/strict';
import { test } from 'node:test';
import { extensionBrowser } from './rpc.ts';

test('Chromium adapter holds callback messaging open and reports failures', async () => {
  const globals = globalThis as typeof globalThis & { chrome?: unknown; browser?: unknown };
  const oldChrome = Object.getOwnPropertyDescriptor(globals, 'chrome');
  const oldBrowser = Object.getOwnPropertyDescriptor(globals, 'browser');
  let callback!: (message: unknown, sender: unknown, reply: (value: unknown) => void) => boolean;
  Object.defineProperty(globals, 'browser', { configurable: true, value: undefined });
  Object.defineProperty(globals, 'chrome', {
    configurable: true,
    value: {
      runtime: {
        id: 'own',
        getURL: (p: string) => 'chrome-extension://own/' + p,
        sendMessage: async () => ({ ok: true, value: true }),
        onMessage: {
          addListener: (cb: typeof callback) => {
            callback = cb;
          },
        },
      },
    },
  });
  try {
    const api = extensionBrowser()!;
    assert.equal(api.runtime.getURL('options.html'), 'chrome-extension://own/options.html');
    api.runtime.onMessage.addListener(async () => ({ ok: true, value: 'reply' }));
    let response: unknown;
    assert.equal(
      callback({}, {}, (value) => {
        response = value;
      }),
      true,
    );
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.deepEqual(response, { ok: true, value: 'reply' });
    api.runtime.onMessage.addListener(async () => {
      throw new Error('private details');
    });
    callback({}, {}, (value) => {
      response = value;
    });
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.deepEqual(response, { ok: false, error: 'Extension request failed' });
  } finally {
    if (oldChrome) Object.defineProperty(globals, 'chrome', oldChrome);
    else Reflect.deleteProperty(globals, 'chrome');
    if (oldBrowser) Object.defineProperty(globals, 'browser', oldBrowser);
    else Reflect.deleteProperty(globals, 'browser');
  }
});
