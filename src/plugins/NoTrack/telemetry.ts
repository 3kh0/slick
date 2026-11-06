// Slack's telemetry endpoints, from uAssets and the AdGuard filters.

export const TELEMETRY = [
  '*://slackb.com/*',
  '*://*.slackb.com/*',
  '*://slack.com/beacon/*',
  '*://*.slack.com/beacon/*',
  '*://slack.com/clog/*',
  '*://*.slack.com/clog/*',
];

const RULES = TELEMETRY.map((pattern) => {
  const [, wildcard, host, path] = /^\*:\/\/(\*\.)?([^/]+)(\/[^*]*)\*$/.exec(pattern)!;
  return { wildcard: !!wildcard, host, path };
});

export function isTelemetry(url: unknown, base = globalThis.location?.href): boolean {
  let target: URL;
  try {
    target = new URL(String(url), base);
  } catch {
    return false;
  }
  if (target.protocol !== 'https:' && target.protocol !== 'http:') return false;
  return RULES.some(
    ({ wildcard, host, path }) =>
      (wildcard ? target.hostname.endsWith(`.${host}`) : target.hostname === host) && target.pathname.startsWith(path),
  );
}

type Page = {
  XMLHttpRequest: { prototype: XMLHttpRequest };
  fetch: typeof fetch;
  navigator: Navigator;
};

// Blocked requests fail like a network error, so Slack's clog gives up after
// eight in a row exactly as it does behind the desktop block.
export function blockTelemetry(page: Page, { beacons }: { beacons: boolean }): () => void {
  let active = true;
  const restores: (() => void)[] = [];
  const swap = <T extends object, K extends keyof T>(target: T, key: K, wrap: (original: T[K]) => T[K]) => {
    const original = target[key];
    const patched = wrap(original);
    target[key] = patched;
    restores.push(() => {
      if (target[key] === patched) target[key] = original;
    });
  };

  const blocked = new WeakSet<XMLHttpRequest>();
  const xhr = page.XMLHttpRequest.prototype;
  swap(
    xhr,
    'open',
    (open) =>
      function (this: XMLHttpRequest, ...args: unknown[]) {
        Reflect.deleteProperty(this, 'readyState');
        if (active && isTelemetry(args[1])) blocked.add(this);
        else blocked.delete(this);
        return (open as (...args: unknown[]) => void).apply(this, args);
      } as XMLHttpRequest['open'],
  );
  swap(
    xhr,
    'send',
    (send) =>
      function (this: XMLHttpRequest, body?: Document | XMLHttpRequestBodyInit | null) {
        if (!active || !blocked.has(this)) return send.call(this, body);
        setTimeout(() => {
          Object.defineProperty(this, 'readyState', { value: 4, configurable: true });
          for (const type of ['readystatechange', 'error', 'loadend']) this.dispatchEvent(new Event(type));
        });
      },
  );

  swap(
    page,
    'fetch',
    (original) => (input: RequestInfo | URL, init?: RequestInit) =>
      active && isTelemetry(typeof input === 'object' && 'url' in input ? input.url : input)
        ? Promise.reject(new TypeError('Failed to fetch'))
        : original.call(page, input, init),
  );

  if (beacons && typeof page.navigator.sendBeacon === 'function')
    swap(
      page.navigator,
      'sendBeacon',
      (original) => (url: string | URL, data?: BodyInit | null) =>
        active && isTelemetry(url) ? true : original.call(page.navigator, url, data),
    );

  return () => {
    active = false;
    for (const restore of restores) restore();
  };
}
