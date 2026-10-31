import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { randomBytes } from 'node:crypto';
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

function fixture(blocked = false, downloadProxy = '') {
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
    payload: null as Buffer | null,
    dropOnce: false,
    dropped: false,
    ranges: [] as number[][],
    archives: [] as Buffer[],
    get(url: string, options: any, callback: (res: any) => void) {
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
          const range = /^bytes=(\d+)-(\d+)$/.exec(options?.headers?.Range ?? '');
          if (f.payload && range) {
            const start = Number(range[1]);
            const end = Math.min(Number(range[2]), f.payload.length - 1);
            f.ranges.push([start, end]);
            res.statusCode = 206;
            res.headers['content-range'] = `bytes ${start}-${end}/${f.payload.length}`;
            res.headers['content-length'] = String(end - start + 1);
            const body = f.payload.subarray(start, end + 1);
            if (f.dropOnce && start > 0 && !f.dropped) {
              f.dropped = true;
              res.write(body.subarray(0, 10));
              res.destroy();
            } else {
              res.end(body);
            }
          } else {
            res.headers['content-length'] = '4';
            res.end('test');
          }
        }
      });
      return request;
    },
    extract(_cmd: string, args: string[], callback: (error?: Error) => void) {
      f.archives.push(fs.readFileSync(args[2]));
      const destination = args.at(-1)!;
      fs.mkdirSync(path.join(destination, 'Slick.app', 'Contents', 'MacOS'), { recursive: true });
      callback();
    },
  };
  (globalThis as any).__updaterFixture = f;
  return { f, updater: createUpdater({ version: '2.0.116', build: 116, downloadProxy: () => downloadProxy }) };
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

const CHUNK = 2 * 1024 * 1024;

test(
  'downloads Range chunks in parallel and reassembles the file',
  { skip: process.platform !== 'darwin' },
  async () => {
    const { f, updater } = fixture();
    f.payload = randomBytes(2 * CHUNK + 12345);
    await updater.manualCheckForUpdates();
    await updater.activate();
    assert.equal(updater.getStatus().state, 'ready');
    assert.ok(f.archives[0].equals(f.payload));
    assert.deepEqual(
      f.ranges.map(([start]) => start).toSorted((a, b) => a - b),
      [0, CHUNK, 2 * CHUNK],
    );
  },
);

test('retries a chunk whose connection drops', { skip: process.platform !== 'darwin' }, async () => {
  const { f, updater } = fixture();
  f.payload = randomBytes(2 * CHUNK);
  f.dropOnce = true;
  await updater.manualCheckForUpdates();
  await updater.activate();
  assert.equal(updater.getStatus().state, 'ready');
  assert.ok(f.archives[0].equals(f.payload));
  assert.equal(f.ranges.length, 3);
});

test(
  'an invalid download proxy fails the update instead of going direct',
  { skip: process.platform !== 'darwin' },
  async () => {
    const { f, updater } = fixture(false, 'socks5://proxy.example:1080');
    await updater.manualCheckForUpdates();
    await updater.activate();
    assert.equal(updater.getStatus().state, 'error');
    assert.match(updater.getStatus().detail, /http:\/\/host:port/);
    assert.equal(f.downloads, 0);
  },
);

test.after(() => {
  delete (globalThis as any).__updaterFixture;
  fs.rmSync(temp, { recursive: true, force: true });
});
