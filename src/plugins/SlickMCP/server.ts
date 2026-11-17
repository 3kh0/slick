import { createServer } from 'node:http';
import { randomUUID, timingSafeEqual } from 'node:crypto';
import { AsyncLocalStorage } from 'node:async_hooks';
import {
  createMcpHandler,
  isInitializeRequest,
  isLegacyRequest,
  WebStandardStreamableHTTPServerTransport,
  type McpServer,
} from '@modelcontextprotocol/server';
import { toNodeHandler } from '@modelcontextprotocol/node';
import { OperationStore } from './operations.ts';
import { createAgentServer, type AgentBackend, type AgentToolOptions } from './tools.ts';

export async function startMcpServer(
  port: number,
  token: string,
  backend: AgentBackend,
  receipts?: OperationStore,
  toolOptions: AgentToolOptions = {},
) {
  if (token.length < 32) throw new Error('MCP connection token is missing or too short');
  const operations = receipts ?? (await OperationStore.load());
  const requests = new AsyncLocalStorage<AbortSignal>();
  const lifetime = new AbortController();
  const factory = (sessionSignal?: AbortSignal) =>
    createAgentServer(
      (action, args, signal) => {
        const request = requests.getStore();
        const { __scope, ...params } = args;
        return backend(
          action,
          params,
          AbortSignal.any([
            signal,
            lifetime.signal,
            ...(request ? [request] : []),
            ...(sessionSignal ? [sessionSignal] : []),
          ]),
          __scope as import('./tools.ts').OperationScope | undefined,
        );
      },
      operations,
      toolOptions,
    );
  const handler = createMcpHandler(() => factory(), { legacy: 'reject', maxRequestBodySize: 1024 * 1024 });
  type Session = {
    server: McpServer;
    transport: WebStandardStreamableHTTPServerTransport;
    controller: AbortController;
    updated: number;
  };
  const sessions = new Map<string, Session>();
  let creating = 0;
  const endSession = async (id: string, session: Session) => {
    sessions.delete(id);
    session.controller.abort();
    await session.server.close();
  };
  const expire = () =>
    Promise.all(
      [...sessions]
        .filter(([, entry]) => entry.updated < Date.now() - 60 * 60 * 1000)
        .map(([id, entry]) => endSession(id, entry)),
    );
  const timer = setInterval(() => {
    void expire().catch(() => {});
  }, 60_000);
  timer.unref();
  const serve = toNodeHandler(
    {
      fetch: (request) =>
        requests.run(request.signal, async () => {
          const parsed =
            request.method === 'POST'
              ? await request
                  .clone()
                  .json()
                  .catch(() => undefined)
              : undefined;
          if (!(await isLegacyRequest(request, parsed))) return handler.fetch(request, { parsedBody: parsed });
          const id = request.headers.get('mcp-session-id');
          if (id) {
            const entry = sessions.get(id);
            if (!entry) return new Response('MCP session expired; reconnect the client', { status: 404 });
            entry.updated = Date.now();
            return entry.transport.handleRequest(request, { parsedBody: parsed });
          }
          if (request.method !== 'POST')
            return new Response('Method not allowed', { status: 405, headers: { Allow: 'POST' } });
          if (!isInitializeRequest(parsed)) return new Response('Initialize an MCP session first', { status: 400 });
          await expire();
          if (sessions.size + creating >= 64) return new Response('Too many local MCP sessions', { status: 503 });
          creating++;
          try {
            const controller = new AbortController();
            const product = await factory(controller.signal);
            let entry: Session;
            let initialized = false;
            const transport = new WebStandardStreamableHTTPServerTransport({
              sessionIdGenerator: randomUUID,
              onsessioninitialized: (sessionId) => {
                if (lifetime.signal.aborted) return;
                initialized = true;
                sessions.set(sessionId, entry);
              },
              onsessionclosed: (sessionId) => {
                sessions.delete(sessionId);
                controller.abort();
              },
            });
            entry = { server: product, transport, controller, updated: Date.now() };
            try {
              await product.connect(transport);
              return await transport.handleRequest(request, { parsedBody: parsed });
            } finally {
              if (!initialized) {
                controller.abort();
                await product.close();
              }
            }
          } finally {
            creating--;
          }
        }),
    },
    { maxRequestBodySize: 1024 * 1024 },
  );
  const server = createServer((request, response) => {
    response.setHeader('Cache-Control', 'no-store');
    if (lifetime.signal.aborted) {
      response.writeHead(503).end('MCP server is stopping');
      return;
    }
    const host = request.headers.host;
    if (
      host !== `127.0.0.1:${(server.address() as { port: number } | null)?.port}` ||
      request.headers.origin !== undefined
    ) {
      response.writeHead(403).end('Only local MCP clients are allowed');
      return;
    }
    const authorization = Buffer.from(request.headers.authorization ?? '');
    const expected = Buffer.from(`Bearer ${token}`);
    if (authorization.length !== expected.length || !timingSafeEqual(authorization, expected)) {
      response.writeHead(401, { 'WWW-Authenticate': 'Bearer realm="Slick MCP"' }).end('Connection token required');
      return;
    }
    if (request.url !== '/mcp') {
      response.writeHead(404).end('Not found');
      return;
    }
    if (Number(request.headers['content-length']) > 1024 * 1024) {
      request.resume();
      response.writeHead(413).end('MCP request exceeds 1 MiB');
      return;
    }
    void serve(request, response).catch(() => {
      if (!response.headersSent) response.writeHead(500);
      response.end();
    });
  });
  server.requestTimeout = 35_000;
  server.headersTimeout = 10_000;
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', () => {
      server.removeListener('error', reject);
      resolve();
    });
  }).catch(async (error) => {
    clearInterval(timer);
    await handler.close();
    throw error;
  });
  return {
    url: `http://127.0.0.1:${(server.address() as { port: number }).port}/mcp`,
    async close() {
      clearInterval(timer);
      lifetime.abort();
      await Promise.allSettled([...sessions].map(([id, entry]) => endSession(id, entry)));
      try {
        await handler.close();
      } finally {
        await new Promise<void>((resolve, reject) => {
          server.close((error) => (error ? reject(error) : resolve()));
          server.closeAllConnections();
        });
      }
    },
  };
}
