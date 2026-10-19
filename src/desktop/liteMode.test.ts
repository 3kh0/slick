import assert from 'node:assert/strict';
import { test } from 'node:test';
import { badgeFromTitle, isSlackUrl, isSsoUrl, liteRequested, liteUserAgent } from './liteMode.ts';

test('user agent loses the app, Electron and Slack desktop tokens', () => {
  const slick =
    'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Slick/2.0.135 Chrome/152.0.7977.130 Electron/44.4.5 Safari/537.36';
  const slack =
    'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Slack/4.52.178 Chrome/152.0.7977.130 Electron/44.4.5 Safari/537.36 Sonic Slack_SSB/4.52.178';
  const chrome =
    'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/152.0.7977.130 Safari/537.36';
  assert.equal(liteUserAgent(slick), chrome);
  assert.equal(liteUserAgent(slack), chrome);
  assert.equal(liteUserAgent(chrome), chrome);
});

test('badge reads counts and unread markers from the title', () => {
  assert.equal(badgeFromTitle('(12) general - Hack Club - Slack'), 12);
  assert.equal(badgeFromTitle('* general - Hack Club - Slack'), 1);
  assert.equal(badgeFromTitle('! general - Hack Club - Slack'), 1);
  assert.equal(badgeFromTitle('general - Hack Club - Slack'), 0);
});

test('only https Slack and SSO hosts stay in-app', () => {
  assert.ok(isSlackUrl('https://app.slack.com/client/T0266FRGM'));
  assert.ok(isSlackUrl('https://files.slack.com/files-pri/x'));
  assert.ok(!isSlackUrl('http://app.slack.com/client'));
  assert.ok(!isSlackUrl('https://slack.com.evil.example/'));
  assert.ok(!isSlackUrl('https://notslack.com/'));
  assert.ok(isSsoUrl('https://accounts.google.com/o/oauth2'));
  assert.ok(!isSsoUrl('https://github.com/'));
  assert.ok(!isSlackUrl('not a url'));
});

test('lite mode is opt in by flag or env', () => {
  assert.ok(liteRequested(['electron', '.', '--lite'], {}));
  assert.ok(liteRequested(['electron', '.'], { SLICK_LITE: '1' }));
  assert.ok(!liteRequested(['electron', '.'], {}));
});
