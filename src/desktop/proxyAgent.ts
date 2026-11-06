// HTTPS through an HTTP(S) proxy by CONNECT tunnel. Node's https has no proxy
// support of its own and a dependency is overkill for one verb.

import http from 'node:http';
import https from 'node:https';
import tls from 'node:tls';

const CONNECT_TIMEOUT_MS = 20_000;

/** The class is built on demand so importing this module never touches https.Agent. */
export function createProxyAgent(proxy: URL): https.Agent {
  const auth = proxy.username
    ? `Basic ${Buffer.from(`${decodeURIComponent(proxy.username)}:${decodeURIComponent(proxy.password)}`).toString('base64')}`
    : '';
  const transport = proxy.protocol === 'https:' ? https : http;

  class ProxyAgent extends https.Agent {
    createConnection(options: any, callback: any): any {
      const target = `${options.host}:${options.port || 443}`;
      const req = transport.request({
        host: proxy.hostname,
        port: proxy.port || (proxy.protocol === 'https:' ? 443 : 80),
        method: 'CONNECT',
        path: target,
        headers: { Host: target, ...(auth && { 'Proxy-Authorization': auth }) },
        timeout: CONNECT_TIMEOUT_MS,
      });
      req.once('timeout', () => req.destroy(new Error('proxy timed out')));
      req.once('error', (error) => callback(error));
      req.once('connect', (res, socket) => {
        if (res.statusCode !== 200) {
          socket.destroy();
          callback(new Error(`proxy refused the connection (HTTP ${res.statusCode})`));
          return;
        }
        callback(null, tls.connect({ ...options, socket, servername: options.servername || options.host }));
      });
      req.end();
    }
  }
  return new ProxyAgent({ keepAlive: true });
}
