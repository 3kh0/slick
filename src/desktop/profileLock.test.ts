import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { clearStaleProfileLock } from './profileLock.ts';

test('stale locks from an old hostname are removed without following their targets', (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'slick-lock-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const target = path.join(dir, 'socket-target');
  fs.writeFileSync(target, 'keep');
  fs.symlinkSync('old-host.local-2147483647', path.join(dir, 'SingletonLock'));
  fs.symlinkSync(target, path.join(dir, 'SingletonSocket'));
  fs.symlinkSync('12345', path.join(dir, 'SingletonCookie'));
  clearStaleProfileLock(dir);
  assert.deepEqual(fs.readdirSync(dir), ['socket-target']);
  assert.equal(fs.readFileSync(target, 'utf8'), 'keep');
  clearStaleProfileLock(dir);
});

test('a live process retains its lock even after a hostname change', (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'slick-lock-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const lock = path.join(dir, 'SingletonLock');
  fs.symlinkSync(`old-host.local-${process.pid}`, lock);
  clearStaleProfileLock(dir);
  assert.equal(fs.readlinkSync(lock), `old-host.local-${process.pid}`);
});

test('unrecognized locks and regular files are preserved', (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'slick-lock-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const lock = path.join(dir, 'SingletonLock');
  fs.symlinkSync('unknown-lock', lock);
  clearStaleProfileLock(dir);
  assert.equal(fs.readlinkSync(lock), 'unknown-lock');
  fs.unlinkSync(lock);
  fs.symlinkSync('old-host-2147483647', lock);
  fs.writeFileSync(path.join(dir, 'SingletonCookie'), 'keep');
  clearStaleProfileLock(dir);
  assert.equal(fs.readFileSync(path.join(dir, 'SingletonCookie'), 'utf8'), 'keep');
});
