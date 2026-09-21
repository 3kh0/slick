// Deciding whether a frame should be gated, and building the placeholder.

import { INTERNAL_DOMAINS, PROVIDERS } from './meta.ts';

export type Provider = { key: string; label: string };

export const matchesDomain = (host: string, domains: readonly string[]): boolean =>
  domains.some((domain) => host === domain || host.endsWith(`.${domain}`));

/**
 * Which gate a frame source falls under, or null if it should load freely.
 * `inMessage` says whether the frame is inside a message -- an embed Slack
 * puts in its own chrome is Slack's business, one in a message is a third
 * party someone else chose.
 */
export function providerFor(source: string, base: string, inMessage: boolean): Provider | null {
  let url: URL;
  try {
    url = new URL(source, base);
  } catch {
    return null;
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;

  const known = PROVIDERS.find((provider) => matchesDomain(url.hostname, provider.domains));
  if (known) return { key: known.key, label: known.label };

  if (!inMessage || matchesDomain(url.hostname, INTERNAL_DOMAINS)) return null;
  return { key: 'other', label: url.hostname };
}

const escapeHtml = (value: string): string =>
  value.replace(
    /[&<>"']/g,
    (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char] as string,
  );

/**
 * The placeholder document. It is a `srcdoc`, so it is same-origin-null and
 * cannot see the page; it reports a click by posting to its parent rather than
 * navigating, which is what lets the page ask for permission before the real
 * request is made.
 */
export function placeholder(source: string, label: string): string {
  const destination = escapeHtml(source);
  const provider = escapeHtml(label);
  return `<!doctype html>
<meta name="color-scheme" content="light dark">
<style>
  html, body { height: 100%; margin: 0; background: transparent; }
  body { font: 600 14px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
  button {
    box-sizing: border-box;
    display: grid;
    grid-template-rows: auto 1fr;
    align-items: center;
    width: 100%;
    height: 100%;
    min-height: 72px;
    padding: 18px;
    border: 1px solid color-mix(in srgb, CanvasText 25%, transparent);
    border-radius: 16px;
    background: transparent;
    color: CanvasText;
    font: inherit;
    text-align: center;
    cursor: pointer;
    outline-offset: -4px;
  }
  button:hover .url { text-decoration: underline; }
  .label { align-self: start; }
  .url {
    align-self: center;
    font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
    font-weight: 400;
    word-break: break-all;
  }
</style>
<button type="button" aria-label="Click to load ${provider}">
  <span class="label">Click to load ${provider}</span>
  <span class="url">${destination}</span>
</button>
<script>
  document.querySelector('button').addEventListener('click', function () {
    parent.postMessage({ slickClick2Load: true }, '*');
  });
</script>`;
}
