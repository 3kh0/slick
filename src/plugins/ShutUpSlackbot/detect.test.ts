import assert from 'node:assert/strict';
import { test } from 'node:test';
import { decodeMrkdwn, isSlackbot, isSlashCommandNotice, notificationText } from './detect.ts';

test('decodeMrkdwn: unwraps labelled and bare links', () => {
  assert.equal(decodeMrkdwn('see <https://x.test|the docs>'), 'see the docs');
  assert.equal(decodeMrkdwn('see <https://x.test>'), 'see https://x.test');
  assert.equal(decodeMrkdwn(undefined), '');
});

test('notificationText: flattens every field a notification may carry', () => {
  assert.equal(
    notificationText({ title: 'Slackbot', body: 'a <https://x.test|new> command' }),
    'Slackbot a new command',
  );
  assert.equal(notificationText('plain'), 'plain');
});

test('isSlashCommandNotice: matches a registration notice', () => {
  assert.ok(isSlashCommandNotice('A new slash command /deploy was added to this workspace'));
  assert.ok(isSlashCommandNotice('Someone registered the same command /ship'));
});

test('isSlashCommandNotice: needs both a subject and a registration verb', () => {
  // Slash commands, but nothing was registered.
  assert.equal(isSlashCommandNotice('Slash commands are unavailable right now'), false);
  // A registration verb, but not about slash commands.
  assert.equal(isSlashCommandNotice('A new member joined #general'), false);
  // Someone simply typing a command in a DM.
  assert.equal(isSlashCommandNotice('try /giphy sometime'), false);
  assert.equal(isSlashCommandNotice(''), false);
});

test('isSlackbot: by id or by name', () => {
  assert.ok(isSlackbot('USLACKBOT'));
  assert.ok(isSlackbot('U123456', 'Slackbot'));
  assert.equal(isSlackbot('U123456', 'Slackbot Deluxe'), false);
  assert.equal(isSlackbot('U123456'), false);
});
