import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test, type TestContext } from 'node:test';
import { expandSoundPath, overrideNativeSound, prepareNativeSound } from './native.ts';

function fixture(t: TestContext) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'slick-custom-sound-test-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const source = path.join(root, 'custom.mp3');
  fs.writeFileSync(source, 'audio');
  return { root, source, directory: path.join(root, 'Sounds') };
}

test('native sounds are converted once per content and staged outside the signed bundle', async (t) => {
  const { source, directory } = fixture(t);
  let conversions = 0;
  const convert = async (input: string, output: string) => {
    conversions++;
    fs.copyFileSync(input, output);
  };
  const first = await prepareNativeSound(source, directory, convert);
  assert.match(first, /^slick-custom-[a-f0-9]{64}\.caf$/);
  assert.equal(await prepareNativeSound(source, directory, convert), first);
  assert.equal(conversions, 1);
  fs.writeFileSync(source, 'changed audio');
  assert.notEqual(await prepareNativeSound(source, directory, convert), first);
  assert.equal(conversions, 2);
  assert.equal(fs.readdirSync(directory).length, 2);
});

test('failed conversion cleans up and can be retried', async (t) => {
  const { source, directory } = fixture(t);
  await assert.rejects(
    prepareNativeSound(source, directory, async () => {
      throw new Error('invalid audio');
    }),
  );
  assert.deepEqual(fs.readdirSync(directory), []);
  await prepareNativeSound(source, directory, async (input, output) => {
    fs.copyFileSync(input, output);
  });
  assert.equal(fs.readdirSync(directory).length, 1);
});

test('native override respects Slack mute, web playback, and default notifications', () => {
  const notification = { sound: 'slick-b2.caf', silent: false };
  overrideNativeSound(notification, 'slick-custom-test.caf');
  assert.equal(notification.sound, 'slick-custom-test.caf');
  for (const options of [{ sound: 'none' }, { sound: 'b2.mp3', silent: true }, {}]) {
    const original = { ...options };
    overrideNativeSound(options, 'slick-custom-test.caf');
    assert.deepEqual(options, original);
  }
  overrideNativeSound(notification, null);
  assert.equal(notification.sound, 'slick-custom-test.caf');
});

test('sound paths expand tilde after trimming', () => {
  assert.equal(expandSoundPath(' ~/sound.mp3 '), path.join(os.homedir(), 'sound.mp3'));
});
