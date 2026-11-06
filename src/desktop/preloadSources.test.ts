import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { createPreloadSources } from './preloadSources.ts';

test('live tokens keep their original source across file changes and independent window closure', () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'slick-preload-sources-'));
  const file = path.join(dir, 'preload.js');
  try {
    const sources = createPreloadSources();
    writeFileSync(file, 'globalThis.version = 1;');
    const first = sources.register(file);
    const second = sources.register(file);
    assert.notEqual(first, second);
    assert.equal(sources.get(first), readFileSync(file, 'utf8'));
    assert.equal(sources.get(second), sources.get(first));
    writeFileSync(file, 'globalThis.version = 2;');
    const third = sources.register(file);
    assert.equal(sources.get(third), readFileSync(file, 'utf8'));
    assert.equal(sources.get(first), 'globalThis.version = 1;');
    sources.release(first);
    sources.release(first);
    assert.equal(sources.get(first), null);
    assert.equal(sources.get(second), 'globalThis.version = 1;');
    assert.equal(sources.get(third), 'globalThis.version = 2;');
    sources.release(third);
    assert.equal(sources.get(second), 'globalThis.version = 1;');
    const fourth = sources.register(file);
    assert.equal(sources.get(fourth), 'globalThis.version = 2;');
    sources.release(second);
    sources.release(fourth);
    assert.equal(sources.get('unknown'), null);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('new windows always read their own path and failed reads do not replace live tokens', () => {
  const files = new Map([
    ['one.js', 'one'],
    ['two.js', 'two'],
  ]);
  const reads: string[] = [];
  const sources = createPreloadSources((file) => {
    reads.push(file);
    const text = files.get(file);
    if (text === undefined) throw new Error('unreadable');
    return text;
  });
  const first = sources.register('one.js');
  const second = sources.register('two.js');
  sources.register('one.js');
  assert.deepEqual(reads, ['one.js', 'two.js', 'one.js']);
  files.delete('one.js');
  assert.throws(() => sources.register('one.js'), /unreadable/);
  files.set('one.js', ' \n\t ');
  assert.throws(() => sources.register('one.js'), /preload is empty/);
  assert.equal(sources.get(first), 'one');
  assert.equal(sources.get(second), 'two');
});
