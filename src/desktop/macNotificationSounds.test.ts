import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { macNotificationOptions, macNotificationSoundName, wrapMacNotifications } from './macNotificationSounds.ts';

test('maps Slack sounds only when the converted file exists in Slick resources', (t) => {
  const resources = fs.mkdtempSync(path.join(os.tmpdir(), 'slick-sound-test-'));
  t.after(() => fs.rmSync(resources, { recursive: true, force: true }));
  const original = { title: 'Message', sound: 'knock_brush.mp3', silent: false, hasReply: true };
  assert.equal(macNotificationOptions(original, resources), original);
  fs.writeFileSync(path.join(resources, 'slick-knock_brush.caf'), 'converted');
  assert.deepEqual(macNotificationOptions(original, resources), { ...original, sound: 'slick-knock_brush.caf' });
  assert.equal(original.sound, 'knock_brush.mp3');
  const silent = { ...original, silent: true };
  assert.equal(macNotificationOptions(silent, resources), silent);
});

test('stages packaged sounds in the user sound search directory without touching the bundle', (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'slick-sound-install-test-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const resources = path.join(root, 'Resources');
  const sounds = path.join(root, 'Library', 'Sounds');
  fs.mkdirSync(resources);
  fs.writeFileSync(path.join(resources, 'slick-b2.caf'), 'converted');
  const options = { sound: 'b2.mp3' };
  const mapped = macNotificationOptions(options, resources, sounds);
  assert.match(mapped.sound!, /^slick-stock-[a-f0-9]{64}\.caf$/);
  assert.notEqual(mapped.sound, 'slick-b2.caf');
  assert.equal(fs.readFileSync(path.join(sounds, mapped.sound!), 'utf8'), 'converted');
  assert.deepEqual(macNotificationOptions(options, resources, sounds), mapped);
  assert.equal(fs.readdirSync(sounds).length, 1);
  assert.equal(fs.readFileSync(path.join(resources, 'slick-b2.caf'), 'utf8'), 'converted');
  assert.equal(options.sound, 'b2.mp3');
});

test('updated bundled audio gets a fresh native name rather than reusing a cached sound', (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'slick-sound-update-test-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const sounds = path.join(root, 'Sounds');
  const source = path.join(root, 'slick-knock_brush.caf');
  fs.writeFileSync(source, 'old audio');
  const original = { sound: 'knock_brush.mp3', hasReply: true };
  const first = macNotificationOptions(original, root, sounds);
  fs.writeFileSync(source, 'new audio');
  const second = macNotificationOptions(original, root, sounds);
  assert.notEqual(first.sound, second.sound);
  assert.equal(second.hasReply, true);
  assert.equal(original.sound, 'knock_brush.mp3');
  assert.equal(fs.readFileSync(path.join(sounds, first.sound!), 'utf8'), 'old audio');
  assert.equal(fs.readFileSync(path.join(sounds, second.sound!), 'utf8'), 'new audio');
});

test('muted, web-playback, and unknown sounds do not stage any files', (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'slick-sound-muted-test-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const sounds = path.join(root, 'Sounds');
  fs.writeFileSync(path.join(root, 'slick-b2.caf'), 'audio');
  for (const options of [{ sound: 'b2.mp3', silent: true }, { sound: 'none' }, { sound: 'Glass' }, {}]) {
    macNotificationOptions(options, root, sounds);
  }
  assert.equal(fs.existsSync(sounds), false);
});

test('Slack none suppresses the native fallback for muted sounds and web playback', () => {
  assert.deepEqual(macNotificationOptions({ sound: 'none', silent: false }, '/missing'), {
    sound: 'none',
    silent: true,
  });
  const defaultSound = { title: 'Default' };
  assert.equal(macNotificationOptions(defaultSound, '/missing'), defaultSound);
});

test('sound names cannot reference arbitrary paths or replace system sounds', () => {
  assert.equal(macNotificationSoundName('boop.mp3'), 'slick-boop.caf');
  for (const sound of ['../boop.mp3', '/boop.mp3', 'sub/boop.mp3', 'sub\\boop.mp3', 'Glass', 'none', 'boop.caf']) {
    assert.equal(macNotificationSoundName(sound), null);
  }
});

test('constructor bridge preserves native instances, static methods, and show filters', () => {
  const calls: string[] = [];
  class Notification {
    static isSupported() {
      return true;
    }
    options: Electron.NotificationConstructorOptions;
    constructor(options: Electron.NotificationConstructorOptions) {
      this.options = options;
    }
    show() {
      calls.push('shown');
    }
  }
  // Plugin filters patch the original prototype, including after the bridge.
  const Wrapped = wrapMacNotifications(Notification, '/missing');
  const show = Notification.prototype.show;
  Notification.prototype.show = function () {
    calls.push('filter');
    show.call(this);
  };
  const notification = new Wrapped({ sound: 'none' });
  assert.ok(notification instanceof Notification);
  assert.ok(notification instanceof Wrapped);
  assert.equal(Wrapped.isSupported(), true);
  assert.equal(notification.options.silent, true);
  notification.show();
  assert.deepEqual(calls, ['filter', 'shown']);
});
