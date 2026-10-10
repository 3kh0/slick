// Run `npm run bench:storage:browser`, then open the printed localhost URL.
import http from 'node:http';
import { mkdir, writeFile } from 'node:fs/promises';
import { build } from 'esbuild';

const bundle = await build({
  stdin: {
    contents: `import { runStoragePerformance } from './scripts/fixtures/storagePerformance.ts';
    runStoragePerformance().then(async result => {
      await fetch('/results', {method: 'POST', body: JSON.stringify(result)});
      globalThis.__slickStoragePerformance = result;
      document.body.textContent = JSON.stringify(result, null, 2);
    }).catch(error => { document.body.textContent = error.stack; });`,
    resolveDir: process.cwd(),
  },
  bundle: true,
  write: false,
  platform: 'browser',
  format: 'iife',
});
const server = http.createServer(async (request, response) => {
  if (request.url === '/fixture.js') {
    response.setHeader('Content-Type', 'application/javascript');
    response.end(bundle.outputFiles[0].contents);
  } else if (request.url === '/results' && request.method === 'POST') {
    let text = '';
    for await (const chunk of request) {
      text += chunk;
      if (text.length > 32 * 1024) {
        response.writeHead(413).end();
        return;
      }
    }
    try {
      const result: unknown = JSON.parse(text);
      await mkdir('work/performance', { recursive: true });
      await writeFile('work/performance/browser-results.json', JSON.stringify(result, null, 2) + '\n');
      console.log(text);
      response.end('saved');
    } catch {
      response.writeHead(400).end();
    }
  } else {
    response.setHeader('Content-Type', 'text/html');
    response.end(
      '<!doctype html><title>Slick isolated storage benchmark</title><body>Running…<script src="/fixture.js"></script>',
    );
  }
});
server.listen(0, '127.0.0.1', () => {
  const address = server.address();
  if (address && typeof address === 'object') console.log(`http://127.0.0.1:${address.port}`);
});
