// Synthetic, credential-free fixtures. Run `npm run bench:performance`.
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { Script } from 'node:vm';
import { withTimestamps, sliceCovers, type ChannelHistory } from '../src/app/slack/messageHistory.ts';
import { mapConcurrent } from '../src/shared/concurrent.ts';
import { createAssetReader } from '../src/desktop/assetReader.ts';
import { mutate, readAll } from '../src/desktop/blobStore.ts';
import { ScopedStorage, type BlobStore } from '../src/app/api/storage.ts';
import { createDictionaryLookup, packDictionary } from '../src/plugins/HaikuWarning/dictionary.ts';
import { compactDictionary } from '../src/plugins/HaikuWarning/haiku.ts';
import { buildApp } from './build/app.ts';

const results: Record<string, unknown> = {
  node: process.version,
  platform: `${process.platform}/${process.arch}`,
  synthetic: true,
};
const median = (values: number[]) => values.toSorted((a, b) => a - b)[Math.floor(values.length / 2)];
async function time(work: () => unknown | Promise<unknown>, count = 5) {
  const samples: number[] = [];
  for (let i = 0; i < count; i++) {
    const start = performance.now();
    await work();
    samples.push(performance.now() - start);
  }
  return median(samples);
}

// Prior helper algorithm retained as an explicit benchmark reference.
function arrayHistory(history: ChannelHistory, added: string[], excluded: string[] = []) {
  let changed = false;
  const slices = history.slices ?? [];
  const next = slices.map((slice, position) => {
    if (!Array.isArray(slice.timestamps)) return slice;
    const kept = slice.timestamps.filter((ts) => !excluded.includes(ts));
    const missing = added.filter((ts) => sliceCovers(history, slice, position, ts) && !kept.includes(ts));
    if (!missing.length && kept.length === slice.timestamps.length) return slice;
    changed = true;
    return { ...slice, timestamps: [...kept, ...missing].toSorted() };
  });
  return changed ? next : slices;
}

const directory = await mkdtemp(path.join(os.tmpdir(), 'slick-performance-'));
const previousProfile = process.env.SLICK_HANDOFF_PROFILE;
process.env.SLICK_HANDOFF_PROFILE = directory;
try {
  const ts = (i: number) => `${1700000000 + i}.000000`;
  const histories = [];
  for (const [n, a, e] of [
    [100, 10, 10],
    [1000, 100, 100],
    [1000, 500, 500],
  ]) {
    const history = { slices: [{ timestamps: Array.from({ length: n }, (_, i) => ts(i)) }] };
    const added = Array.from({ length: a }, (_, i) => ts(n - Math.floor(a / 2) + i));
    const excluded = Array.from({ length: e }, (_, i) => ts(i));
    assert.deepEqual(withTimestamps(history, added, excluded), arrayHistory(history, added, excluded));
    for (let i = 0; i < 50; i++) {
      arrayHistory(history, added, excluded);
      withTimestamps(history, added, excluded);
    }
    const run = (fn: typeof withTimestamps) =>
      time(() => {
        for (let i = 0; i < 200; i++) fn(history, added, excluded);
      }, 9);
    histories.push({
      timestamps: n,
      added: a,
      excluded: e,
      arrayMs: (await run(arrayHistory)) / 200,
      setMs: (await run(withTimestamps)) / 200,
    });
  }
  results.history = histories;

  const changes: [string, string][] = Array.from({ length: 128 }, (_, i) => [
    `entry:${i}`,
    JSON.stringify({ text: 'x'.repeat(1024), at: i }),
  ]);
  const baseline = path.join(directory, 'serial');
  const serialMs = await time(async () => {
    for (const [key, value] of changes) {
      await mkdir(baseline, { recursive: true });
      const file = path.join(baseline, `${key.replaceAll(':', process.platform === 'win32' ? '%3A' : ':')}.json`);
      await writeFile(`${file}.tmp`, value);
      await rename(`${file}.tmp`, file);
    }
  });
  const batchMs = await time(async () => {
    assert.equal(await mutate('plugin:MessageLogger', changes), true);
  });
  assert.deepEqual(await readAll('plugin:MessageLogger'), Object.fromEntries(changes));
  results.diskWrites = { entries: changes.length, serialMs, batchMs };

  const reads = Array.from({ length: 1000 }, (_, i) => path.join(directory, 'reads', `${i}.json`));
  await mkdir(path.dirname(reads[0]), { recursive: true });
  await mapConcurrent(reads, (file) => writeFile(file, 'x'.repeat(4096)));
  const concurrency = [];
  for (const limit of [1, 4, 16, 64, 1000]) {
    let peak = 0;
    const ms = await time(async () => {
      let active = 0;
      const data = await mapConcurrent(
        reads,
        async (file) => {
          peak = Math.max(peak, ++active);
          try {
            return await readFile(file, 'utf8');
          } finally {
            active--;
          }
        },
        limit,
      );
      assert.equal(data.length, reads.length);
    });
    concurrency.push({ limit, ms, peak });
  }
  results.diskReads = concurrency;

  const bundle = path.join(directory, 'bundle.js');
  await writeFile(bundle, 'x'.repeat(512 * 1024));
  const requestCount = 32;
  const syncMs = await time(() => {
    for (let i = 0; i < requestCount; i++) readFileSync(bundle);
  });
  let physicalReads = 0;
  const cached = createAssetReader(true, async (file) => {
    physicalReads++;
    return readFile(file);
  });
  const coldCachedMs = await time(async () => {
    const cold = createAssetReader(true);
    await Promise.all(Array.from({ length: requestCount }, () => cold(bundle)));
  });
  await Promise.all(Array.from({ length: requestCount }, () => cached(bundle)));
  const warmCachedMs = await time(async () => {
    await Promise.all(Array.from({ length: requestCount }, () => cached(bundle)));
  });
  assert.equal(physicalReads, 1);
  results.assets = { requests: requestCount, syncMs, coldCachedMs, warmCachedMs, physicalReads };

  let messages = 0;
  const blob: BlobStore = {
    list: async () => [],
    read: async () => null,
    readAll: async () => ({}),
    clear: async () => true,
    write: async () => {
      messages++;
      return true;
    },
    delete: async () => {
      messages++;
      return true;
    },
    mutate: async () => {
      messages++;
      return true;
    },
  };
  const storage = new ScopedStorage(blob);
  const entries = changes.map(([key, value]): [string, unknown] => [key, JSON.parse(value)]);
  for (const [key, value] of entries) await storage.set(key, value);
  const individualMessages = messages;
  messages = 0;
  assert.equal(await storage.batch(entries), true);
  results.storageTransport = { entries: entries.length, individualMessages, batchMessages: messages };

  const raw = await readFile('src/plugins/HaikuWarning/syllable_counts.txt', 'utf8');
  const dictionary = compactDictionary(raw);
  const packed = packDictionary(dictionary);
  const first = dictionary.slice(0, dictionary.indexOf('\n'));
  const separator = first.lastIndexOf(' ');
  const firstLookupMs = await time(() => {
    assert.equal(createDictionaryLookup(packed)(first.slice(0, separator)), Number(first.slice(separator + 1)));
  });
  const outputs = [];
  for (const compressDictionary of [false, true]) {
    const file = await buildApp({ compressDictionary, outFile: path.join(directory, `${compressDictionary}.js`) });
    const code = await readFile(file, 'utf8');
    let sample = 0;
    const compileMs = await time(() => new Script(`${code}\n// compile sample ${sample++}`), 9);
    outputs.push({ compressed: compressDictionary, bytes: Buffer.byteLength(code), compileMs });
  }
  results.dictionary = { plainBytes: dictionary.length, packedBytes: packed.length, firstLookupMs, builds: outputs };
  await mkdir('work/performance', { recursive: true });
  await writeFile('work/performance/results.json', JSON.stringify(results, null, 2) + '\n');
  console.log(JSON.stringify(results, null, 2));
} finally {
  if (previousProfile === undefined) delete process.env.SLICK_HANDOFF_PROFILE;
  else process.env.SLICK_HANDOFF_PROFILE = previousProfile;
  await rm(directory, { recursive: true, force: true });
}
