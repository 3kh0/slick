import { open, unlink } from 'node:fs/promises';
import { isAbsolute, basename } from 'node:path';
import { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import type { ReadableStream } from 'node:stream/web';

export const MAX_FILE_BYTES = 64 * 1024 * 1024;
type Fetcher = (url: string, init: RequestInit) => Promise<Response>;
type Api = (method: string, params: Record<string, unknown>) => Promise<any>;

function absolute(path: string) {
  if (!isAbsolute(path)) throw new Error('Use an absolute local file path');
}

export function slackTransferUrl(value: string): URL {
  const url = new URL(value);
  if (
    url.protocol !== 'https:' ||
    url.username ||
    url.password ||
    url.port ||
    !['files.slack.com', 'files-origin.slack.com', 'files.slack-edge.com'].includes(url.hostname)
  )
    throw new Error('Slack returned an untrusted file transfer URL');
  return url;
}

export async function writeDownload(
  response: Response,
  destination: string,
  signal: AbortSignal,
  maxBytes = MAX_FILE_BYTES,
) {
  absolute(destination);
  if (!response.ok || !response.body) {
    await response.body?.cancel();
    throw new Error(`File download failed (HTTP ${response.status})`);
  }
  if (Number(response.headers.get('content-length')) > maxBytes) {
    await response.body.cancel();
    throw new Error('File exceeds the 64 MiB download limit');
  }
  const file = await open(destination, 'wx', 0o600).catch(async (error) => {
    await response.body?.cancel();
    throw error;
  });
  let bytes = 0;
  try {
    const bound = new Transform({
      transform(chunk, _encoding, callback) {
        bytes += chunk.length;
        callback(bytes > maxBytes ? new Error('File exceeds the 64 MiB download limit') : null, chunk);
      },
    });
    await pipeline(Readable.fromWeb(response.body as ReadableStream), bound, file.createWriteStream(), { signal });
    return { path: destination, bytes };
  } catch (error) {
    await file.close();
    await unlink(destination).catch(() => {});
    throw error;
  } finally {
    await file.close();
  }
}

export async function downloadSlackFile(
  info: { url: string; token?: string; mimetype?: string },
  destination: string,
  fetcher: Fetcher,
  signal: AbortSignal,
) {
  absolute(destination);
  let url = slackTransferUrl(info.url);
  for (let count = 0; count < 6; count++) {
    signal.throwIfAborted();
    const trusted = ['files.slack.com', 'files-origin.slack.com', 'files.slack-edge.com'].includes(url.hostname);
    const response = await fetcher(url.href, {
      redirect: 'manual',
      credentials: trusted ? 'include' : 'omit',
      signal,
      headers: trusted && info.token ? { Authorization: `Bearer ${info.token}` } : {},
    });
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      const location = response.headers.get('location');
      await response.body?.cancel();
      if (!location) throw new Error('File redirect is missing its destination');
      url = new URL(location, url);
      if (url.protocol !== 'https:' || url.username || url.password) throw new Error('Unsafe file download redirect');
      continue;
    }
    if (response.headers.get('content-type')?.includes('text/html') && info.mimetype !== 'text/html') {
      await response.body?.cancel();
      throw new Error('Slack returned a sign-in page instead of file contents');
    }
    return writeDownload(response, destination, signal);
  }
  throw new Error('Too many file download redirects');
}

export async function uploadSlackFile(
  path: string,
  options: { title?: string; channel?: string; thread_ts?: string; initial_comment?: string },
  api: Api,
  fetcher: Fetcher,
  signal: AbortSignal,
) {
  absolute(path);
  if (options.thread_ts && !options.channel) throw new Error('A thread upload requires channel');
  if (options.initial_comment && !options.channel) throw new Error('An upload comment requires channel');
  const file = await open(path, 'r');
  const parts: Buffer[] = [];
  let bytes = 0;
  try {
    const stat = await file.stat();
    if (!stat.isFile()) throw new Error('Upload path must be a regular file');
    if (stat.size > MAX_FILE_BYTES) throw new Error('File exceeds the 64 MiB upload limit');
    for await (const chunk of file.createReadStream({ autoClose: false })) {
      signal.throwIfAborted();
      bytes += chunk.length;
      if (bytes > MAX_FILE_BYTES) throw new Error('File exceeds the 64 MiB upload limit');
      parts.push(Buffer.from(chunk));
    }
  } finally {
    await file.close();
  }
  if (!bytes) throw new Error('Cannot upload an empty file');
  signal.throwIfAborted();
  const pending = await api('files.getUploadURLExternal', { filename: basename(path), length: bytes });
  if (!pending.file_id || !pending.upload_url) throw new Error('Slack did not provide an upload URL and file ID');
  const url = slackTransferUrl(pending.upload_url);
  const response = await fetcher(url.href, {
    method: 'POST',
    body: new Uint8Array(Buffer.concat(parts)),
    redirect: 'error',
    credentials: 'omit',
    signal,
    headers: { 'Content-Type': 'application/octet-stream' },
  });
  await response.body?.cancel();
  if (!response.ok)
    throw new Error(`Uploading file bytes failed (HTTP ${response.status}); file ${pending.file_id} was not shared`);
  signal.throwIfAborted();
  const result = await api('files.completeUploadExternal', {
    files: [{ id: pending.file_id, title: options.title || basename(path) }],
    ...(options.channel ? { channel_id: options.channel } : {}),
    ...(options.thread_ts ? { thread_ts: options.thread_ts } : {}),
    ...(options.initial_comment ? { initial_comment: options.initial_comment } : {}),
  });
  return { ...result, bytes };
}
