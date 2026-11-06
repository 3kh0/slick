import assert from 'node:assert/strict';
import http from 'node:http';
import https from 'node:https';
import type { AddressInfo } from 'node:net';
import test from 'node:test';
import { createProxyAgent } from './proxyAgent.ts';

function listen(status: number) {
  const seen: { target?: string; auth?: string } = {};
  const server = http.createServer();
  server.on('connect', (req, socket) => {
    seen.target = req.url;
    seen.auth = req.headers['proxy-authorization'];
    socket.end(`HTTP/1.1 ${status} Nope\r\n\r\n`);
  });
  return new Promise<{ url: (auth?: string) => URL; seen: typeof seen; close: () => void }>((resolve) =>
    server.listen(0, '127.0.0.1', () =>
      resolve({
        url: (auth = '') => new URL(`http://${auth}127.0.0.1:${(server.address() as AddressInfo).port}`),
        seen,
        close: () => server.close(),
      }),
    ),
  );
}

test('asks the proxy to CONNECT to the target with basic auth', async () => {
  const proxy = await listen(407);
  const agent = createProxyAgent(proxy.url('me:p%40ss@'));
  try {
    await assert.rejects(
      new Promise((resolve, reject) => https.get('https://example.test/file', { agent }, resolve).on('error', reject)),
      /proxy refused the connection \(HTTP 407\)/,
    );
    assert.equal(proxy.seen.target, 'example.test:443');
    assert.equal(proxy.seen.auth, `Basic ${Buffer.from('me:p@ss').toString('base64')}`);
  } finally {
    agent.destroy();
    proxy.close();
  }
});

test('sends no auth header when the proxy URL has no credentials', async () => {
  const proxy = await listen(502);
  const agent = createProxyAgent(proxy.url());
  try {
    await assert.rejects(
      new Promise((resolve, reject) => https.get('https://example.test/', { agent }, resolve).on('error', reject)),
      /HTTP 502/,
    );
    assert.equal(proxy.seen.auth, undefined);
  } finally {
    agent.destroy();
    proxy.close();
  }
});
