// URL cleaning, as a pure function over the ClearURLs rule set.
//
// Separated from the plugin so it can be tested without Slack or the network,
// which matters more here than anywhere else in the port: this rewrites what
// the user is about to send, and getting it wrong sends a broken link.

/** A provider entry from the ClearURLs rule set, already compiled. */
export type Provider = {
  urlPattern: RegExp;
  rules: RegExp[];
  rawRules: RegExp[];
  exceptions: RegExp[];
};

/** One user-supplied rule: a parameter name, optionally scoped to a host. */
export type ExtraRule = { param: RegExp; host: RegExp | null };

export type RawProvider = {
  urlPattern?: string;
  rules?: string[];
  rawRules?: string[];
  exceptions?: string[];
};

const regex = (pattern: string) => new RegExp(pattern, 'i');
const regexes = (patterns?: string[]) => (patterns ?? []).map(regex);

/** Compile the fetched rule set, dropping any provider that will not compile. */
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
      // One bad pattern must not cost the whole rule set.
      return [];
    }
  });
}

const escapeRegex = (value: string) => value.replace(/[\\^$.*+?()[\]{}|]/g, '\\$&');
/** `*` in a user rule is a wildcard, everything else is literal. */
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

/**
 * Strip tracking parameters from one URL. Returns the input unchanged if it is
 * not a URL, has no query, or matches nothing -- by reference, so a caller can
 * test whether anything happened.
 */
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
    // An exception means this provider's rules must not run at all -- some
    // parameters that look like tracking are load-bearing on some sites.
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
  // URL normalizes as a side effect, so only hand back a rewrite we made.
  return url.href;
}

/** Every URL inside a run of text, cleaned in place. */
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
