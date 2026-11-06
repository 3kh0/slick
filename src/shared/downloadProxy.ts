// The update-download proxy setting, shared by the settings UI and the updater.

export const PROXY_HINT = 'Use http://host:port or https://host:port, with user:password@ if it needs a login.';

/** The proxy URL, or null when none is set. Throws a readable error when the text is not a usable proxy. */
export function parseDownloadProxy(text: unknown): URL | null {
  const raw = typeof text === 'string' ? text.trim() : '';
  if (!raw) return null;
  let url: URL;
  try {
    url = new URL(/^[a-z][a-z\d+.-]*:\/\//i.test(raw) ? raw : `http://${raw}`);
  } catch {
    throw new Error(PROXY_HINT);
  }
  if ((url.protocol !== 'http:' && url.protocol !== 'https:') || !url.hostname) throw new Error(PROXY_HINT);
  return url;
}
