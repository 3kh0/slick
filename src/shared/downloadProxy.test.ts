import assert from 'node:assert/strict';
import test from 'node:test';
import { parseDownloadProxy } from './downloadProxy.ts';

test('empty means direct; a bare host:port is an http proxy', () => {
  assert.equal(parseDownloadProxy(''), null);
  assert.equal(parseDownloadProxy('   '), null);
  assert.equal(parseDownloadProxy(undefined), null);
  assert.equal(parseDownloadProxy('127.0.0.1:3128')?.href, 'http://127.0.0.1:3128/');
  assert.equal(parseDownloadProxy(' https://proxy.example:8443 ')?.hostname, 'proxy.example');
});

test('credentials are kept and anything that is not http(s) is rejected', () => {
  const url = parseDownloadProxy('http://me:p%40ss@proxy.example:80');
  assert.equal(url?.username, 'me');
  assert.equal(decodeURIComponent(url?.password ?? ''), 'p@ss');
  for (const bad of ['socks5://proxy.example:1080', 'ftp://proxy.example', 'http://', 'not a url']) {
    assert.throws(() => parseDownloadProxy(bad), /http:\/\/host:port/);
  }
});
