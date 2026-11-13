import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { gunzipSync, gzipSync } from 'node:zlib';
import { markCodeHealthy, readCodeState, selectCode, type ShellInfo } from './codeBoot.ts';
import { createCodePack, installCodePack, openCodePack, pruneCode, readTar, writeTar } from './codePack.ts';

const SHELL: ShellInfo = { format: 1, id: 'shell-a', build: 100 };
const files = () =>
  new Map<string, Uint8Array>([
    ['main.js', Buffer.from('export const main = 1;')],
    ['slick.js', Buffer.from('void 0')],
    ['licenses/Plugin/NOTICE.txt', Buffer.alloc(1500, 'x')],
  ]);
const pack = (build: number, shell = SHELL.id) => createCodePack(files(), { build, version: `2.0.${build}`, shell });

function setup(t: { after: (fn: () => void) => void }) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'slick-code-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const resources = path.join(dir, 'resources');
  fs.mkdirSync(resources);
  fs.writeFileSync(path.join(resources, 'shell.json'), JSON.stringify(SHELL));
  return { root: path.join(dir, 'code'), resources };
}

test('tar round trip keeps names and bytes', () => {
  const input = files();
  const output = readTar(writeTar(input));
  assert.deepEqual([...output.keys()].toSorted(), [...input.keys()].toSorted());
  for (const [name, data] of input) assert.ok(output.get(name)!.equals(Buffer.from(data)));
});

test('rejects packs for another shell, another build, or with tampered or unsafe files', () => {
  assert.throws(() => openCodePack(pack(101, 'shell-b'), SHELL, 101), /different app shell/);
  assert.throws(() => openCodePack(pack(102), SHELL, 101), /build 102/);

  const tampered = readTar(gunzipSync(pack(101)));
  tampered.set('main.js', Buffer.from('evil()'));
  assert.throws(() => openCodePack(gzipSync(writeTar(tampered)), SHELL, 101), /does not match/);

  const extra = readTar(gunzipSync(pack(101)));
  extra.set('extra.js', Buffer.from('1'));
  assert.throws(() => openCodePack(gzipSync(writeTar(extra)), SHELL, 101), /unexpected file/);

  assert.throws(() => readTar(writeTar(new Map([['../escape.js', Buffer.from('1')]]))), /unsafe path/);
});

test('installed code boots once verified and is ignored once the app catches up', (t) => {
  const { root, resources } = setup(t);
  assert.equal(selectCode(resources, root), null);
  installCodePack(pack(101), SHELL, 101, root);
  const chosen = selectCode(resources, root);
  assert.equal(chosen?.build, 101);
  assert.ok(fs.existsSync(path.join(chosen!.dir, 'licenses/Plugin/NOTICE.txt')));
  markCodeHealthy(101, root);
  assert.equal(readCodeState(root).booting, undefined);

  fs.writeFileSync(path.join(resources, 'shell.json'), JSON.stringify({ ...SHELL, build: 101 }));
  assert.equal(selectCode(resources, root), null);
  pruneCode({ ...SHELL, build: 101 }, root);
  assert.deepEqual(fs.readdirSync(root), ['state.json']);
});

test('a different shell, a corrupted file or repeated failed boots fall back to the app', (t) => {
  const { root, resources } = setup(t);
  installCodePack(pack(101), SHELL, 101, root);
  fs.writeFileSync(path.join(resources, 'shell.json'), JSON.stringify({ ...SHELL, id: 'shell-b' }));
  assert.equal(selectCode(resources, root), null);
  assert.deepEqual(readCodeState(root).bad, [101]);
  fs.writeFileSync(path.join(resources, 'shell.json'), JSON.stringify(SHELL));
  assert.throws(() => installCodePack(pack(101), SHELL, 101, root), /already failed/);

  installCodePack(pack(102), SHELL, 102, root);
  fs.writeFileSync(path.join(root, '102', 'slick.js'), 'tampered');
  assert.equal(selectCode(resources, root), null);
  assert.match(readCodeState(root).lastError!, /slick.js does not match/);

  installCodePack(pack(103), SHELL, 103, root);
  assert.equal(selectCode(resources, root)?.build, 103);
  assert.equal(selectCode(resources, root)?.build, 103);
  assert.equal(selectCode(resources, root), null, 'two boots that never got healthy');
  assert.deepEqual(readCodeState(root).bad, [101, 102, 103]);
});

test('pruning keeps the active and previous builds', (t) => {
  const { root } = setup(t);
  for (const build of [101, 102, 103]) installCodePack(pack(build), SHELL, build, root);
  pruneCode(SHELL, root);
  assert.deepEqual(fs.readdirSync(root).toSorted(), ['102', '103', 'state.json']);
});
