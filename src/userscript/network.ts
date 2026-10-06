import type { GMApi } from './gm.ts';

export function gmFetch(gm: GMApi, url: string, init: RequestInit = {}): Promise<{ status: number; body: string }> {
  const target = new URL(url);
  if (!['https:', 'http:'].includes(target.protocol)) return Promise.reject(new Error('Unsupported request URL'));
  if (init.body != null && typeof init.body !== 'string') return Promise.reject(new Error('Request body must be text'));
  return new Promise((resolve, reject) =>
    gm.request({
      url: target.href,
      method: init.method ?? 'GET',
      headers: Object.fromEntries(new Headers(init.headers).entries()),
      data: init.body as string | undefined,
      anonymous: true,
      timeout: 30000,
      onload: (response) => resolve({ status: response.status, body: response.responseText }),
      onerror: () => reject(new Error('Userscript request failed')),
      ontimeout: () => reject(new Error('Userscript request timed out')),
    }),
  );
}
