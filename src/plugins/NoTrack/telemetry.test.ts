import assert from 'node:assert/strict';
import { test } from 'node:test';
import { blockTelemetry, isTelemetry } from './telemetry.ts';

const tick = () => new Promise((resolve) => setTimeout(resolve));

test('isTelemetry matches only Slack telemetry endpoints', () => {
  for (const url of [
    'https://hackclub.slack.com/clog/track/',
    'https://app.slack.com/clog/track/?x=1',
    'https://slack.com/clog/track/',
    'https://hackclub.enterprise.slack.com/clog/track/',
    'https://slackb.com/traces/v1/list_of_spans/proto',
    'https://a.slackb.com/anything',
    'https://slack.com/beacon/timing',
    'https://app.slack.com/beacon/error',
    new URL('https://app.slack.com/clog/track/'),
  ])
    assert.equal(isTelemetry(url), true, String(url));
  for (const url of [
    'https://app.slack.com/api/conversations.history',
    'https://files.slack.com/files-pri/T0/clog/x',
    'https://evil-slack.com/clog/track/',
    'https://slack.com.evil.com/clog/track/',
    'https://notslackb.com/x',
    'wss://wss-primary.slack.com/clog/',
    'not a url',
    undefined,
  ])
    assert.equal(isTelemetry(url, 'about:blank'), false, String(url));
  assert.equal(isTelemetry('/clog/track/', 'https://app.slack.com/client/T0'), true);
  assert.equal(isTelemetry('clog/track/', 'https://app.slack.com/'), true);
});

class FakeXhr extends EventTarget {
  state = 0;
  sent: unknown[] = [];
  get readyState() {
    return this.state;
  }
  open(_method: string, _url: string) {
    this.state = 1;
  }
  send(body?: unknown) {
    this.sent.push(body);
  }
}

function fakePage() {
  const beacons: unknown[] = [];
  const fetched: unknown[] = [];
  const page = {
    XMLHttpRequest: FakeXhr,
    fetch: async (input: unknown) => {
      fetched.push(input);
      return new Response('ok');
    },
    navigator: {
      sendBeacon: (url: unknown) => {
        beacons.push(url);
        return true;
      },
    },
  };
  return { page, beacons, fetched, originals: { ...page, open: FakeXhr.prototype.open, send: FakeXhr.prototype.send } };
}

test('blocked XHRs fail like a network error and others go through', async () => {
  const { page, originals } = fakePage();
  const unblock = blockTelemetry(page as any, { beacons: true });
  try {
    const xhr = new FakeXhr();
    const events: string[] = [];
    for (const type of ['readystatechange', 'error', 'load', 'loadend'])
      xhr.addEventListener(type, () => events.push(`${type}:${xhr.readyState}`));
    xhr.open('POST', 'https://hackclub.slack.com/clog/track/');
    xhr.send('{"logs":[]}');
    assert.deepEqual(xhr.sent, []);
    await tick();
    assert.deepEqual(events, ['readystatechange:4', 'error:4', 'loadend:4']);

    xhr.open('POST', 'https://app.slack.com/api/chat.postMessage');
    assert.equal(xhr.readyState, 1);
    xhr.send('body');
    assert.deepEqual(xhr.sent, ['body']);
  } finally {
    unblock();
  }
  assert.equal(FakeXhr.prototype.open, originals.open);
  assert.equal(FakeXhr.prototype.send, originals.send);
});

test('fetch and beacons to telemetry are dropped; disposal restores or passes through', async () => {
  const { page, beacons, fetched, originals } = fakePage();
  const unblock = blockTelemetry(page as any, { beacons: true });
  await assert.rejects(page.fetch('https://slackb.com/traces/v1/x'), TypeError);
  await assert.rejects(page.fetch(new Request('https://app.slack.com/clog/track/') as any), TypeError);
  assert.equal(await (await page.fetch('https://app.slack.com/api/x')).text(), 'ok');
  assert.equal(page.navigator.sendBeacon('https://app.slack.com/beacon/x'), true);
  page.navigator.sendBeacon('https://example.com/');
  assert.deepEqual(fetched, ['https://app.slack.com/api/x']);
  assert.deepEqual(beacons, ['https://example.com/']);

  const ours = page.fetch;
  const outer = (input: unknown) => ours(input);
  page.fetch = outer as any;
  unblock();
  assert.equal(page.fetch, outer);
  assert.equal(page.navigator.sendBeacon, originals.navigator.sendBeacon);
  await page.fetch('https://slackb.com/traces/v1/x');
  assert.deepEqual(fetched.at(-1), 'https://slackb.com/traces/v1/x');
});

test('beacons are left alone when the setting is off', () => {
  const { page, beacons, originals } = fakePage();
  const unblock = blockTelemetry(page as any, { beacons: false });
  assert.equal(page.navigator.sendBeacon, originals.navigator.sendBeacon);
  page.navigator.sendBeacon('https://app.slack.com/beacon/x');
  assert.deepEqual(beacons, ['https://app.slack.com/beacon/x']);
  unblock();
});
