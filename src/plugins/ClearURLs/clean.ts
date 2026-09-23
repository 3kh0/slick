// Pure URL cleaning over the ClearURLs rule set, testable without Slack or the
// network: getting it wrong sends the user's link broken.

export type Provider = {
  urlPattern: RegExp;
  rules: RegExp[];
  rawRules: RegExp[];
  exceptions: RegExp[];
};

export type ExtraRule = { param: RegExp; host: RegExp | null };

export type RawProvider = {
  urlPattern?: string;
  rules?: string[];
  rawRules?: string[];
  exceptions?: string[];
};

const regex = (pattern: string) => new RegExp(pattern, 'i');
const regexes = (patterns?: string[]) => (patterns ?? []).map(regex);

export function compileProviders(data: unknown): Provider[] {
  const providers = (data as { providers?: Record<string, RawProvider> } | null)?.providers;
  if (!providers || typeof providers !== 'object') return [];

  return Object.values(providers).flatMap((provider) => {
    try {
      return [
        {
          urlPattern: regex(provider.urlPattern ?? ''),
          rules: regexes(provider.rules),
          rawRules: regexes(provider.rawRules),
          exceptions: regexes(provider.exceptions),
        },
      ];
    } catch {
      return [];
    }
  });
}

const escapeRegex = (value: string) => value.replace(/[\\^$.*+?()[\]{}|]/g, '\\$&');
const wildcard = (value: string) => escapeRegex(value).replace(/\\\*/g, '.+?');

export function compileExtraRules(value: unknown): ExtraRule[] {
  return String(value ?? '')
    .split(',')
    .map((rule) => rule.trim())
    .filter(Boolean)
    .flatMap((rule) => {
      const [param, host] = rule.split('@');
      try {
        return [
          {
            param: new RegExp(`^${wildcard(param)}$`),
            host: host
              ? new RegExp(
                  `^(www\\.)?${escapeRegex(host)
                    .replace(/^\\\*\\\./, '(.+?\\.)?')
                    .replace(/\\\*/g, '.+?')}$`,
                )
              : null,
          },
        ];
      } catch {
        return [];
      }
    });
}

function dropParams(params: URLSearchParams, matches: (key: string) => boolean): number {
  const doomed: string[] = [];
  // Collected first: deleting while iterating skips entries.
  params.forEach((_value, key) => {
    if (matches(key)) doomed.push(key);
  });
  for (const key of doomed) params.delete(key);
  return doomed.length;
}

/** Returns `input` itself when nothing was removed, so callers can compare by reference. */
export function cleanUrl(input: string, providers: Provider[], extra: ExtraRule[] = []): string {
  let url: URL;
  try {
    url = new URL(input);
  } catch {
    return input;
  }

  let removed = 0;

  for (const provider of providers) {
    if (!provider.urlPattern.test(url.href)) continue;
    // Some tracking-looking params are load-bearing on some sites.
    if (provider.exceptions.some((exception) => exception.test(url.href))) continue;

    removed += dropParams(url.searchParams, (key) => provider.rules.some((rule) => rule.test(key)));

    let href = url.href;
    for (const raw of provider.rawRules) {
      const next = href.replace(raw, '');
      if (next !== href) {
        href = next;
        removed++;
      }
    }
    if (href !== url.href) {
      try {
        url = new URL(href);
      } catch {
        // A rawRule that produced something unparseable is not applied.
        return input;
      }
    }
  }

  const host = url.hostname.toLowerCase();
  removed += dropParams(url.searchParams, (key) =>
    extra.some((rule) => rule.param.test(key) && (!rule.host || rule.host.test(host))),
  );

  if (!removed) return input;
  // URL normalizes as a side effect, so only return it if we changed something.
  return url.href;
}

const URL_IN_TEXT = /https?:\/\/[^\s<>"'`]+/gi;

export function cleanText(text: string, providers: Provider[], extra: ExtraRule[] = []): string {
  if (!text.includes('http')) return text;
  return text.replace(URL_IN_TEXT, (match) => {
    // Trailing punctuation is almost always the sentence, not the URL.
    const trailing = /[.,;:!?)\]]+$/.exec(match)?.[0] ?? '';
    const bare = trailing ? match.slice(0, -trailing.length) : match;
    return cleanUrl(bare, providers, extra) + trailing;
  });
}
