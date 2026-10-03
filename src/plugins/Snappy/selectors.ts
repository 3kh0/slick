// A rightmost `:is()` can't be indexed by class, so Chromium tests the rule
// against every element on every recalc. Split, it matches and cascades the same.

const CLASS_COMPOUND = /^(\.[A-Za-z0-9_-]+)+$/;

function splitTopLevel(text: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let quote: string | null = null;
  let current = '';
  for (const char of text) {
    if (quote) {
      current += char;
      if (char === quote) quote = null;
      continue;
    }
    if (char === '"' || char === "'") quote = char;
    else if (char === '(' || char === '[') depth++;
    else if (char === ')' || char === ']') depth--;
    if (depth === 0 && char === ',') {
      parts.push(current.trim());
      current = '';
    } else current += char;
  }
  parts.push(current.trim());
  return parts;
}

function rightmostCompoundStart(selector: string): number {
  let depth = 0;
  let start = 0;
  for (let i = 0; i < selector.length; i++) {
    const char = selector[i];
    if (char === '(' || char === '[') depth++;
    else if (char === ')' || char === ']') depth--;
    else if (depth === 0 && (char === ' ' || char === '>' || char === '+' || char === '~')) start = i + 1;
  }
  return start;
}

function splitRightmostIs(selector: string): string[] | null {
  const at = rightmostCompoundStart(selector);
  const prefix = selector.slice(0, at);
  const compound = selector.slice(at);
  if (!compound.startsWith(':is(')) return null;

  let depth = 0;
  let end = -1;
  for (let i = 3; i < compound.length; i++) {
    if (compound[i] === '(') depth++;
    else if (compound[i] === ')' && --depth === 0) {
      end = i;
      break;
    }
  }
  if (end < 0) return null;

  const args = splitTopLevel(compound.slice(4, end));
  const rest = compound.slice(end + 1);
  if (!args.every((arg) => CLASS_COMPOUND.test(arg))) return null;

  const classes = args.map((arg) => arg.split('.').filter(Boolean));
  const target = Math.max(...classes.map((list) => list.length));
  return classes.map((list) => {
    const padded = [...list];
    while (padded.length < target) padded.push(list[list.length - 1]);
    return `${prefix}.${padded.join('.')}${rest}`;
  });
}

/** An equivalent, indexable selector list, or null when there's nothing safe to change. */
export function rewriteSelectorList(text: string): string | null {
  if (!text.includes(':is(') || /[\\&]|:scope/.test(text)) return null;
  let changed = false;
  const out: string[] = [];
  for (const selector of splitTopLevel(text)) {
    const split = splitRightmostIs(selector);
    if (split) {
      out.push(...split);
      changed = true;
    } else out.push(selector);
  }
  return changed ? out.join(', ') : null;
}

export type SelectorRewriter = {
  visit(rule: CSSStyleRule): void;
  restore(): void;
};

export function selectorRewriter(): SelectorRewriter {
  const originals = new Map<CSSStyleRule, string>();
  return {
    visit(rule) {
      if (originals.has(rule)) return;
      const before = rule.selectorText;
      const next = rewriteSelectorList(before);
      if (!next) return;
      rule.selectorText = next;
      if (rule.selectorText !== before) originals.set(rule, before);
    },
    restore() {
      for (const [rule, text] of originals) rule.selectorText = text;
      originals.clear();
    },
  };
}
