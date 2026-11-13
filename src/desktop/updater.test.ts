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
      relaunch: () => { globalThis.__updaterFixture.relaunches++; },
      quit: () => { globalThis.__updaterFixture.quits++; globalThis.__updaterFixture.events.emit('will-quit', { preventDefault() {} }); },
      exit: () => { globalThis.__updaterFixture.exits++; },
    };
    export const BrowserWindow = { getAllWindows: () => [] };
    export const dialog = { showMessageBox: async () => { throw Error('Unexpected update dialog'); } };
    export const shell = { openExternal: async () => {} };
  `,
  './bridge.js': `export const broadcast = (_, status) => globalThis.__updaterFixture.statuses.push(status);`,
  './paths.js': `export const settingsDir = () => globalThis.__updaterFixture.dir;`,
  './paths.ts': `export const settingsDir = () => globalThis.__updaterFixture.dir;`,
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
const { createCodePack } = await import('./codePack.ts');

const OS = process.platform === 'darwin' ? 'mac' : process.platform;
const ARCH = process.arch === 'arm64' ? 'arm64' : 'x64';
const SHELL = { format: 1, id: 'aaaabbbbccccdddd', build: 116 };
const CHANGELOG = '# Changelog\n\n## Unreleased\n\n### New\n\n- Shiny thing\n\n## Build 116\n\n- Old thing\n';

function pack(releaseBuild = 117, shell = SHELL.id) {
  const files = new Map<string, Uint8Array>([
    ['main.js', Buffer.from('export {}')],
    ['slick.js', Buffer.from('void 0')],
  ]);
  return createCodePack(files, { build: releaseBuild, version: `2.0.${releaseBuild}`, shell });
}

function fixture(blocked = false, code?: { pack: Buffer; shell?: string }) {
  const dir = fs.mkdtempSync(path.join(temp, 'case-'));
  const resources = fs.mkdtempSync(path.join(temp, 'resources-'));
  fs.writeFileSync(path.join(resources, 'shell.json'), JSON.stringify(SHELL));
  const f = {
    dir,
    blocked,
    code,
    relaunches: 0,
    codeDownloads: 0,
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
                ...(f.code
                  ? [
                      {
                        name: `Slick-2.0.117-code-${OS}-${ARCH}-${f.code.shell ?? SHELL.id}.tar.gz`,
                        browser_download_url: 'https://example.test/code.tar.gz',
                        size: f.code.pack.length,
                      },
                    ]
                  : []),
              ],
            }),
          );
        } else if (url.includes('/attestations/')) {
          res.end(JSON.stringify({ attestations: [{ bundle: {} }] }));
        } else if (url.endsWith('/v117/CHANGELOG.md')) {
          res.end(CHANGELOG);
        } else if (url.endsWith('/code.tar.gz')) {
          f.codeDownloads++;
          res.end(f.code!.pack);
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
  return { f, updater: createUpdater({ version: '2.0.116', build: 116, resources }) };
}

const codeState = (dir: string) => JSON.parse(fs.readFileSync(path.join(dir, 'code', 'state.json'), 'utf8'));

test('a matching code pack installs without touching the app and relaunches on click', async () => {
  const { f, updater } = fixture(false, { pack: pack() });
  await updater.manualCheckForUpdates();
  assert.equal(updater.getStatus().kind, 'code');
  await updater.activate();
  assert.equal(f.codeDownloads, 1);
  assert.equal(f.downloads, 0);
  assert.equal(updater.getStatus().state, 'ready');
  assert.equal(codeState(f.dir).active, 117);
  assert.ok(fs.existsSync(path.join(f.dir, 'code', '117', 'main.js')));
  await updater.activate();
  assert.equal(f.relaunches, 1);
  assert.equal(f.installs.length, 0);
});

test('release notes come from the tagged changelog', async () => {
  const { updater } = fixture(false, { pack: pack() });
  await updater.manualCheckForUpdates();
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.deepEqual(updater.getStatus().notes, [{ build: 117, groups: [{ title: 'New', items: ['Shiny thing'] }] }]);
});

test('a code pack for another shell is ignored', { skip: process.platform !== 'darwin' }, async () => {
  const { f, updater } = fixture(false, { pack: pack(117, 'ffffffffffffffff'), shell: 'ffffffffffffffff' });
  await updater.manualCheckForUpdates();
  assert.equal(updater.getStatus().kind, 'full');
  await updater.activate();
  assert.equal(f.codeDownloads, 0);
  assert.equal(f.downloads, 1);
});

test('a broken code pack falls back to the full update', { skip: process.platform !== 'darwin' }, async () => {
  const { f, updater } = fixture(false, { pack: pack(118) });
  await updater.manualCheckForUpdates();
  await updater.activate();
  assert.equal(f.codeDownloads, 1);
  assert.equal(f.downloads, 1);
  assert.equal(updater.getStatus().kind, 'full');
  assert.equal(fs.existsSync(path.join(f.dir, 'code', '117')), false);
});

test('a code pack failing provenance is refused, not swapped for the full update', async () => {
  const { f, updater } = fixture(true, { pack: pack() });
  await updater.manualCheckForUpdates();
  await updater.activate();
  assert.equal(updater.getStatus().state, 'error');
  assert.match(updater.getStatus().detail, /provenance/);
  assert.equal(f.downloads, 0);
  assert.equal(fs.existsSync(path.join(f.dir, 'code', '117')), false);
});

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
