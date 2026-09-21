import assert from 'node:assert/strict';
import { test } from 'node:test';
import { customSoundUrl, isNotificationSound } from './sounds.ts';

const BASE = 'https://app.slack.com/client/T1/C1';

test('isNotificationSound: matches a hashed asset on slack-edge', () => {
  assert.ok(isNotificationSound('https://a.slack-edge.com/abc/sounds/boop-1a2b3c4d.mp3', BASE));
  assert.ok(isNotificationSound('https://slack-edge.com/knock_brush.ogg', BASE));
});

test('isNotificationSound: matches a same-origin asset', () => {
  assert.ok(isNotificationSound('/sounds/hummus.mp3', BASE));
});

test('isNotificationSound: rejects a lookalike from somewhere else', () => {
  // A file someone actually sent, which happens to be called boop.mp3.
  assert.equal(isNotificationSound('https://files.example.test/boop.mp3', BASE), false);
  // A Slack asset that is not a notification sound.
  assert.equal(isNotificationSound('https://a.slack-edge.com/sounds/applause.mp3', BASE), false);
  assert.equal(isNotificationSound('data:audio/mp3;base64,AAAA', BASE), false);
  assert.equal(isNotificationSound('not a url at all::', BASE), false);
});

test('customSoundUrl: keeps the extension, escapes the path', () => {
  assert.equal(
    customSoundUrl('/Users/me/My Sounds/ding.wav'),
    'slick-custom-sounds://current/sound.wav?p=%2FUsers%2Fme%2FMy%20Sounds%2Fding.wav',
  );
  // No extension falls back to mp3, which the main half corrects by sniffing.
  assert.ok(customSoundUrl('/tmp/sound').startsWith('slick-custom-sounds://current/sound.mp3?'));
});
