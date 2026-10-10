import { createSign } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { setTimeout as sleep } from 'node:timers/promises';
import { unzipSync } from 'fflate';

const [zip] = process.argv.slice(2);
const { CWS_SERVICE_ACCOUNT: key, CWS_PUBLISHER_ID: publisher, CWS_ITEM_ID: item } = process.env;
if (!zip || !key || !publisher || !item) {
  console.error(
    'usage: CWS_SERVICE_ACCOUNT=<json> CWS_PUBLISHER_ID=<id> CWS_ITEM_ID=<id> node scripts/chrome-webstore.ts <slick-chromium.zip>',
  );
  process.exit(1);
}

const api = 'https://chromewebstore.googleapis.com';
const name = `publishers/${publisher}/items/${item}`;
const body = await readFile(zip);
const version: string = JSON.parse(Buffer.from(unzipSync(body)['manifest.json']).toString()).version;

const base64url = (value: string | Buffer) => Buffer.from(value).toString('base64url');

async function accessToken() {
  const account = JSON.parse(key!);
  const now = Math.floor(Date.now() / 1000);
  const unsigned = `${base64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }))}.${base64url(
    JSON.stringify({
      iss: account.client_email,
      scope: 'https://www.googleapis.com/auth/chromewebstore',
      aud: 'https://oauth2.googleapis.com/token',
      iat: now,
      exp: now + 600,
    }),
  )}`;
  const signature = createSign('RSA-SHA256').update(unsigned).sign(account.private_key);
  const { access_token } = await call('https://oauth2.googleapis.com/token', {
    method: 'POST',
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion: `${unsigned}.${base64url(signature)}`,
    }),
  });
  return access_token as string;
}

async function call(url: string, init: RequestInit = {}) {
  const response = await fetch(url, init);
  const text = await response.text();
  if (!response.ok) throw new Error(`${init.method ?? 'GET'} ${url} -> ${response.status}\n${text}`);
  return text ? JSON.parse(text) : {};
}

const newer = (a: string, b: string) => {
  const [x, y] = [a, b].map((v) => v.split('.').map(Number));
  for (let i = 0; i < Math.max(x.length, y.length); i++) {
    if ((x[i] ?? 0) !== (y[i] ?? 0)) return (x[i] ?? 0) > (y[i] ?? 0);
  }
  return false;
};

const headers = { Authorization: `Bearer ${await accessToken()}` };
const status = () => call(`${api}/v2/${name}:fetchStatus`, { headers });

const before = await status();
const submitted = before.submittedItemRevisionStatus;
const versions = [before.publishedItemRevisionStatus, submitted]
  .flatMap((revision) => revision?.distributionChannels ?? [])
  .map((channel: { crxVersion: string }) => channel.crxVersion)
  .filter(Boolean);
const current = versions.find((v: string) => !newer(version, v));
if (current) {
  console.log(`[chrome] store already has ${current}; nothing to publish for ${version}`);
  process.exit(0);
}
if (submitted?.state === 'PENDING_REVIEW') {
  console.log(`::warning::Google is still lookin into ${versions.at(-1) ?? 'a submission'}; skipped ${version}`);
  process.exit(0);
}

let upload = await call(`${api}/upload/v2/${name}:upload`, {
  method: 'POST',
  headers: { ...headers, 'Content-Type': 'application/zip' },
  body,
});
for (let i = 0; /IN_PROGRESS/.test(upload.uploadState) && i < 60; i++) {
  await sleep(5000);
  upload = { uploadState: (await status()).lastAsyncUploadState };
}
if (upload.uploadState !== 'SUCCEEDED') throw new Error(`[chrome] upload ended as ${upload.uploadState}`);
console.log(`[chrome] uploaded ${version}`);

const published = await call(`${api}/v2/${name}:publish`, {
  method: 'POST',
  headers: { ...headers, 'Content-Type': 'application/json' },
  body: JSON.stringify({ publishType: 'DEFAULT_PUBLISH' }),
});
for (const warning of published.warningInfo?.warnings ?? []) {
  console.log(`::warning::${warning.reason}: ${warning.description}`);
}
console.log(`[chrome] submitted ${version}: ${published.state}`);
