import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { PassThrough } from 'node:stream';
import test from 'node:test';
import { build } from 'esbuild';

const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'slick-updater-test-'));
const bundle = path.join(temp, 'updater.mjs');
const shims: Record<string, string> = {
  electron: `
    export const app = {
      getPath: () => globalThis.__updaterFixture.dir,
      on: (...args) => globalThis.__updaterFixture.events.on(...args),
      quit: () => { globalThis.__updaterFixture.quits++; globalThis.__updaterFixture.events.emit('will-quit', { preventDefault() {} }); },
      exit: () => { globalThis.__updaterFixture.exits++; },
    };
    export const BrowserWindow = { getAllWindows: () => [] };
    export const dialog = { showMessageBox: async () => { throw Error('Unexpected update dialog'); } };
    export const shell = { openExternal: async () => {} };
  `,
  './bridge.js': `export const broadcast = (_, status) => globalThis.__updaterFixture.statuses.push(status);`,
  './paths.js': `export const settingsDir = () => globalThis.__updaterFixture.dir;`,
  './attestation.js': `
    export class AttestationError extends Error {}
    export const sha256File = async () => 'digest';
    export const verifyBundle = () => {
      if (globalThis.__updaterFixture.blocked) throw new AttestationError('invalid provenance');
    };
  `,
  'node:https': `export default { get: (...args) => globalThis.__updaterFixture.get(...args) };`,
  'node:child_process': `
    export const execFile = (...args) => globalThis.__updaterFixture.extract(...args);
    export const spawn = (...args) => { globalThis.__updaterFixture.installs.push(args); return { unref() {} }; };
  `,
};
await build({
  entryPoints: [new URL('./updater.ts', import.meta.url).pathname],
  outfile: bundle,
  bundle: true,
  platform: 'node',
  format: 'esm',
  plugins: [
    {
      name: 'updater-fixture',
      setup(builder) {
        builder.onResolve({ filter: /.*/ }, (args) =>
          Object.hasOwn(shims, args.path) ? { path: args.path, namespace: 'fixture' } : undefined,
        );
        builder.onLoad({ filter: /.*/, namespace: 'fixture' }, (args) => ({
          contents: shims[args.path],
          loader: 'js',
        }));
      },
    },
  ],
});
const { createUpdater } = await import(bundle);

function fixture(blocked = false) {
  const dir = fs.mkdtempSync(path.join(temp, 'case-'));
  const f = {
    dir,
    blocked,
    events: new EventEmitter(),
    statuses: [] as any[],
    installs: [] as any[],
    quits: 0,
    exits: 0,
    downloads: 0,
    get(url: string, _options: unknown, callback: (res: any) => void) {
      const request = new EventEmitter() as any;
      request.setTimeout = () => request;
      request.destroy = (error: Error) => request.emit('error', error);
      queueMicrotask(() => {
        const res = new PassThrough() as any;
        res.statusCode = 200;
        res.headers = {};
        callback(res);
        if (url.includes('/releases/latest')) {
          res.end(
            JSON.stringify({
              tag_name: 'v117',
              assets: [
                { name: `Slick-mac-${process.arch}.zip`, browser_download_url: 'https://example.test/update.zip' },
              ],
            }),
          );
        } else if (url.includes('/attestations/')) {
          res.end(JSON.stringify({ attestations: [{ bundle: {} }] }));
        } else {
          f.downloads++;
          res.headers['content-length'] = '4';
          res.end('test');
        }
      });
      return request;
    },
    extract(_cmd: string, args: string[], callback: (error?: Error) => void) {
      const destination = args.at(-1)!;
      fs.mkdirSync(path.join(destination, 'Slick.app', 'Contents', 'MacOS'), { recursive: true });
      callback();
    },
  };
  (globalThis as any).__updaterFixture = f;
  return { f, updater: createUpdater({ version: '2.0.116', build: 116 }) };
}

test(
  'offers silently, ignores duplicate downloads, stages and waits for explicit apply',
  { skip: process.platform !== 'darwin' },
  async () => {
    const { f, updater } = fixture();
    assert.equal((await updater.manualCheckForUpdates()).state, 'available');
    assert.equal(updater.getStatus().state, 'available');
    const downloading = updater.activate();
    await updater.activate();
    await downloading;
    assert.equal(f.downloads, 1);
    assert.ok(f.statuses.some((s) => s.state === 'downloading'));
    assert.equal(updater.getStatus().state, 'ready');
    assert.equal(f.quits, 0);
    assert.equal(f.installs.length, 0);
    await updater.manualCheckForUpdates();
    assert.equal(updater.getStatus().state, 'ready');
    await updater.activate();
    await Promise.resolve();
    assert.equal(f.quits, 1);
    assert.equal(f.installs.length, 1);
    assert.equal(f.installs[0][1].at(-1), '1');
  },
);

test('normal quit installs a staged update without relaunching', { skip: process.platform !== 'darwin' }, async () => {
  const { f, updater } = fixture();
  await updater.manualCheckForUpdates();
  await updater.activate();
  f.events.emit('will-quit', { preventDefault() {} });
  await Promise.resolve();
  assert.equal(f.installs.length, 1);
  assert.equal(f.installs[0][1].at(-1), '');
});

test(
  'failed provenance cleans staging, stays in the button, and can be retried',
  { skip: process.platform !== 'darwin' },
  async () => {
    const { f, updater } = fixture(true);
    await updater.manualCheckForUpdates();
    await updater.activate();
    assert.equal(updater.getStatus().state, 'error');
    assert.match(updater.getStatus().detail, /provenance/);
    assert.equal(f.installs.length, 0);
    assert.equal(fs.readdirSync(f.dir).filter((name) => name.startsWith('slick-update-')).length, 0);
    f.blocked = false;
    await updater.activate();
    assert.equal(updater.getStatus().state, 'ready');
  },
);

test.after(() => {
  delete (globalThis as any).__updaterFixture;
  fs.rmSync(temp, { recursive: true, force: true });
});
