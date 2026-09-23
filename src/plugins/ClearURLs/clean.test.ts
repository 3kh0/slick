import assert from 'node:assert/strict';
import { test } from 'node:test';
import { cleanText, cleanUrl, compileExtraRules, compileProviders } from './clean.ts';

const RULES = {
  providers: {
    global: { urlPattern: '.*', rules: ['utm_.*', 'fbclid'] },
    youtube: {
      urlPattern: 'youtube\\.com',
      rules: ['si'],
      // Playlists legitimately use `si`-adjacent params; stand in for a real exception.
      exceptions: ['youtube\\.com/playlist'],
    },
    tracker: { urlPattern: 'example\\.test', rawRules: ['/ref/[a-z0-9]+'] },
  },
};

const providers = compileProviders(RULES);

test('compileProviders: reads the rule set, and survives a bad pattern', () => {
  assert.equal(providers.length, 3);
  assert.equal(compileProviders({ providers: { bad: { urlPattern: '(' } } }).length, 0);
  assert.deepEqual(compileProviders(null), []);
});

test('cleanUrl: strips matching parameters and keeps the rest', () => {
  assert.equal(cleanUrl('https://shop.test/item?id=7&utm_source=x&fbclid=y', providers), 'https://shop.test/item?id=7');
});

test('cleanUrl: returns the input by reference when nothing matched', () => {
  const url = 'https://shop.test/item?id=7';
  assert.equal(cleanUrl(url, providers), url);
  // Also true of things that are not URLs at all.
  assert.equal(cleanUrl('not a url', providers), 'not a url');
});

test('cleanUrl: an exception disables that provider entirely', () => {
  assert.equal(
    cleanUrl('https://youtube.com/playlist?list=1&si=keepme', providers),
    'https://youtube.com/playlist?list=1&si=keepme',
  );
  assert.equal(cleanUrl('https://youtube.com/watch?v=1&si=drop', providers), 'https://youtube.com/watch?v=1');
});

test('cleanUrl: rawRules rewrite the path', () => {
  assert.equal(cleanUrl('https://example.test/ref/abc123?a=1', providers), 'https://example.test/?a=1');
});

test('compileExtraRules: bare param, host-scoped param, and wildcards', () => {
  const extra = compileExtraRules('ref, sid@shop.test, tr_*@*.ads.test');

  assert.equal(cleanUrl('https://any.test/?ref=1&keep=2', providers, extra), 'https://any.test/?keep=2');
  // Host-scoped: dropped on its host, kept elsewhere.
  assert.equal(cleanUrl('https://shop.test/?sid=1', providers, extra), 'https://shop.test/');
  assert.equal(cleanUrl('https://other.test/?sid=1', providers, extra), 'https://other.test/?sid=1');
  // A wildcard host matches a subdomain, and the wildcard param matches a prefix.
  assert.equal(cleanUrl('https://a.ads.test/?tr_id=1', providers, extra), 'https://a.ads.test/');
  assert.equal(cleanUrl('https://a.ads.test/?other=1', providers, extra), 'https://a.ads.test/?other=1');
});

test('compileExtraRules: ignores empty entries and unparseable rules', () => {
  assert.equal(compileExtraRules('  ,  , ref ').length, 1);
  assert.equal(compileExtraRules('').length, 0);
  assert.equal(compileExtraRules(undefined).length, 0);
});

test('cleanText: cleans URLs inside prose and leaves punctuation alone', () => {
  assert.equal(
    cleanText('see https://shop.test/i?utm_source=x, then go', providers),
    'see https://shop.test/i, then go',
  );
  assert.equal(cleanText('(https://shop.test/i?utm_source=x)', providers), '(https://shop.test/i)');
});

test('cleanText: text with no URL is returned by reference', () => {
  const text = 'nothing to do here';
  assert.equal(cleanText(text, providers), text);
});
