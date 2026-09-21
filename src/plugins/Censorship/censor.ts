// Pure masking helpers. Kept off `$slick` so Node can test them without Slack.

export type CensorStyle = 'stars' | 'hashtags' | 'blocks' | 'custom';

export type CensorConfig = {
  terms: unknown;
  style: unknown;
  replacement: unknown;
  keepFirstLetter: unknown;
  keepLastLetter: unknown;
};

export type Matcher = {
  pattern: RegExp | null;
  mask: (match: string) => string;
};

const MASK_CHARS: Record<Exclude<CensorStyle, 'custom'>, string> = {
  stars: '*',
  hashtags: '#',
  blocks: '█',
};

/** Fields Slack actually draws from. Walk these; leave ids, types, timestamps. */
const TEXT_FIELDS = ['text', 'blocks', 'blocksProcessed', 'attachments'] as const;
const TEXT_KEYS = new Set(['text', 'fallback', 'title', 'pretext', 'footer']);
const WORD_CHAR = /[\p{L}\p{N}_]/u;
const META = /[.*+?^${}()|[\]\\]/g;

export const emptyMatcher: Matcher = { pattern: null, mask: (match) => match };

function escapeRegExp(value: string): string {
  return value.replace(META, '\\$&');
}

function splitTerms(value: unknown): string[] {
  return String(value ?? '')
    .split(/[\n,]/)
    .map((term) => term.trim())
    .filter(Boolean)
    .toSorted((a, b) => b.length - a.length);
}

function termPattern(term: string): string {
  let pattern = term.split(/\s+/).map(escapeRegExp).join('\\s+');
  const chars = Array.from(term);
  if (chars.length && WORD_CHAR.test(chars[0])) pattern = `(?<![\\p{L}\\p{N}_])${pattern}`;
  if (chars.length && WORD_CHAR.test(chars[chars.length - 1])) pattern += `(?![\\p{L}\\p{N}_])`;
  return pattern;
}

function asStyle(value: unknown): CensorStyle {
  return value === 'hashtags' || value === 'blocks' || value === 'custom' ? value : 'stars';
}

function repeated(match: string, char: string, keepFirst: boolean, keepLast: boolean): string {
  const chars = Array.from(match);
  let first = -1;
  let last = -1;
  for (let i = 0; i < chars.length; i++) {
    if (!/\S/.test(chars[i])) continue;
    if (first === -1) first = i;
    last = i;
  }
  return chars
    .map((c, index) => {
      if (!/\S/.test(c)) return c;
      if (keepFirst && index === first) return c;
      if (keepLast && index === last) return c;
      return char;
    })
    .join('');
}

export function compile(config: CensorConfig): Matcher {
  const terms = splitTerms(config.terms);
  const style = asStyle(config.style);
  const replacement = String(config.replacement ?? '') || 'uwu';
  const keepFirst = config.keepFirstLetter === true;
  const keepLast = config.keepLastLetter === true;

  const mask = (match: string): string => {
    if (style === 'custom') return replacement;
    return repeated(match, MASK_CHARS[style], keepFirst, keepLast);
  };

  if (!terms.length) return { pattern: null, mask };

  try {
    return { pattern: new RegExp(terms.map(termPattern).join('|'), 'giu'), mask };
  } catch {
    return { pattern: null, mask };
  }
}

export function censorString(value: string, matcher: Matcher): string {
  if (!matcher.pattern) return value;
  matcher.pattern.lastIndex = 0;
  return value.replace(matcher.pattern, matcher.mask);
}

/** Same structure with every display string masked, or `value` itself if nothing matched. */
export function censorDeep(value: unknown, matcher: Matcher): unknown {
  if (Array.isArray(value)) {
    let changed = false;
    const next = value.map((item) => {
      const out = censorDeep(item, matcher);
      if (out !== item) changed = true;
      return out;
    });
    return changed ? next : value;
  }
  if (!value || typeof value !== 'object') return value;

  let next: Record<string, unknown> | null = null;
  for (const [key, item] of Object.entries(value)) {
    const out =
      TEXT_KEYS.has(key) && typeof item === 'string' ? censorString(item, matcher) : censorDeep(item, matcher);
    if (out === item) continue;
    next ??= { ...(value as Record<string, unknown>) };
    next[key] = out;
  }
  return next ?? value;
}

export function censorMessage<T extends Record<string, unknown>>(msg: T | undefined, matcher: Matcher): T | undefined {
  if (!msg) return msg;
  if (!matcher.pattern) return msg;

  let next: Record<string, unknown> | null = null;
  for (const field of TEXT_FIELDS) {
    if (!Object.hasOwn(msg, field)) continue;
    const value = msg[field];
    // Top-level `text` is a string; blocks/attachments are nested.
    const out = typeof value === 'string' ? censorString(value, matcher) : censorDeep(value, matcher);
    if (out === value) continue;
    next ??= { ...msg };
    next[field] = out;
  }
  return (next as T | null) ?? msg;
}
