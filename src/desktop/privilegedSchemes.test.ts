import assert from 'node:assert/strict';
import { test } from 'node:test';
import { installSchemeMerger } from './privilegedSchemes.ts';

test('merges sequential registerSchemesAsPrivileged calls alongside Sentry proxy', () => {
  const calls: Electron.CustomScheme[][] = [];
  const proto = {
    registerSchemesAsPrivileged(list: Electron.CustomScheme[]) {
      calls.push(list);
    },
  };

  installSchemeMerger(proto);
  proto.registerSchemesAsPrivileged([
    {
      scheme: 'slick',
      privileges: { standard: true, secure: true, bypassCSP: true, supportFetchAPI: true, codeCache: true },
    },
  ]);
  proto.registerSchemesAsPrivileged([
    { scheme: 'slick-custom-font', privileges: { standard: true, secure: true, bypassCSP: true, stream: true } },
  ]);

  // Reproduce Sentry's Proxy wrapper in Slack's app.asar followed by Slack's own registration.
  const sentry = { scheme: 'sentry-ipc', privileges: { secure: true, bypassCSP: true, corsEnabled: true } };
  proto.registerSchemesAsPrivileged([sentry]);
  proto.registerSchemesAsPrivileged = new Proxy(proto.registerSchemesAsPrivileged, {
    apply: (target, _thisArg, args: [Electron.CustomScheme[]]) => target([...args[0], sentry]),
  });
  proto.registerSchemesAsPrivileged([
    { scheme: 'app', privileges: { standard: true, secure: true } },
    { scheme: 'slick', privileges: { corsEnabled: true } },
  ]);

  const final = new Map(calls.at(-1)!.map((entry) => [entry.scheme, entry.privileges]));
  assert.deepEqual([...final.keys()], ['slick', 'slick-custom-font', 'sentry-ipc', 'app']);
  assert.deepEqual(final.get('slick'), {
    standard: true,
    secure: true,
    bypassCSP: true,
    supportFetchAPI: true,
    codeCache: true,
    corsEnabled: true,
  });
  assert.deepEqual(final.get('slick-custom-font'), {
    standard: true,
    secure: true,
    bypassCSP: true,
    stream: true,
  });
  assert.equal(final.get('sentry-ipc')?.bypassCSP, true);
  assert.equal(final.get('app')?.secure, true);
});
