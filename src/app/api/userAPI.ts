// Calling Slack's Web API as the signed-in user.
//
// The token comes from Slack's own localConfig rather than from anything Slick
// stores, so there is no second copy of a credential to leak. Requests go
// through the page's fetch (same origin, cookies included) rather than the
// main process: these are calls Slack itself could make.

import { getActiveTeam } from '../slack/localConfig.ts';

export type UserAPIOptions = {
  rateLimitRetries?: number;
  signal?: AbortSignal;
};

const DEFAULT_RETRY_AFTER_SEC = 2;

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(signal.reason);
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      reject(signal?.reason);
    };
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

/**
 * Call a Web API method as the active user and return the parsed response.
 * Throws if the request or the API call itself failed, so a caller never has
 * to check `ok` as well as catching.
 */
export async function userAPI<T = any>(
  method: string,
  params: Record<string, string | Blob> = {},
  options: UserAPIOptions = {},
): Promise<{ ok: true } & T> {
  const team = getActiveTeam();
  if (!team?.token || !team?.url) throw new Error('[slick] userAPI: no active Slack team or token');

  const url = new URL(`api/${method}`, team.url);
  // Without this Slack omits the CORS headers the response needs.
  url.searchParams.set('_x_gantry', 'true');

  const body = new FormData();
  body.set('token', team.token);
  for (const [name, value] of Object.entries(params)) body.set(name, value);

  const retries = options.rateLimitRetries ?? 0;
  for (let attempt = 0; ; attempt++) {
    const response = await fetch(url.toString(), {
      method: 'POST',
      credentials: 'include',
      body,
      signal: options.signal,
    });

    if (response.status === 429) {
      if (attempt >= retries) throw new Error(`[slick] userAPI ${method} rate limited`);
      const header = Number(response.headers.get('Retry-After'));
      const waitSec = Number.isFinite(header) && header > 0 ? header : DEFAULT_RETRY_AFTER_SEC;
      await sleep(waitSec * 1000, options.signal);
      continue;
    }

    if (!response.ok) {
      let text = '';
      try {
        text = await response.text();
      } catch {}
      throw new Error(`[slick] userAPI ${method} HTTP ${response.status}: ${text}`);
    }

    const json = (await response.json()) as { ok: boolean } & Record<string, any>;
    if (!json.ok) {
      // Slack sometimes reports a rate limit as a 200 with an error string.
      if (json.error === 'ratelimited' || json.error === 'rate_limited') {
        if (attempt < retries) {
          await sleep(DEFAULT_RETRY_AFTER_SEC * 1000, options.signal);
          continue;
        }
      }
      throw new Error(`[slick] userAPI ${method} failed: ${JSON.stringify(json)}`);
    }

    return json as { ok: true } & T;
  }
}
