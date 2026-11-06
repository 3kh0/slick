import assert from 'node:assert/strict';
import { test } from 'node:test';
import { compileRequestPatterns } from './requestPatterns.ts';

test('wildcard matching preserves literal URL punctuation and full-string boundaries', () => {
  const matches = compileRequestPatterns(['https://*.slack.com/api/track?event=*', '*://slack.com/beacon']);
  assert.equal(matches('https://app.slack.com/api/track?event=click'), true);
  assert.equal(matches('https://slack.com/beacon'), true);
  assert.equal(matches('https://appXslack.com/api/track?event=click'), false);
  assert.equal(matches('https://app.slackXcom/api/track?event=click'), false);
  assert.equal(matches('https://app.slack.com/api/trackXevent=click'), false);
  assert.equal(matches('https://slack.com/beacon/extra'), false);
  assert.equal(matches('prefixhttps://app.slack.com/api/track?event=click'), false);
});

test('all URLs and empty filters retain existing matching semantics', () => {
  assert.equal(compileRequestPatterns(['<all_urls>'])('file:///asset'), true);
  assert.equal(compileRequestPatterns([])('https://slack.com'), false);
  const matches = compileRequestPatterns(['https://slack.com/a+(b)[c]$']);
  assert.equal(matches('https://slack.com/a+(b)[c]$'), true);
  assert.equal(matches('https://slack.com/aaabc'), false);
});

test('literal segments escape regex syntax independently of wildcard expansion', () => {
  const literal = String.raw`https://slack.com/a+(b)[c]{d}^$|?\\tail`;
  const matches = compileRequestPatterns([`${literal}*end`]);
  assert.equal(matches(`${literal}middle/end`), true);
  assert.equal(matches(`${literal}end`), true);
  assert.equal(matches(`${literal}end/extra`), false);
  assert.equal(matches(literal.replace('slack.com', 'slackXcom') + 'end'), false);
});
