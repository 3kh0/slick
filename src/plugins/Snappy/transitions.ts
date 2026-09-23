// Collapse Slack's transitions without touching elements that have none.
//
// Never use a universal `* { transition-duration }` rule: any transition
// longhand gives every element `transition-property: all`, so Chromium diffs
// every property on every recalc (measured 2-4x slower style recalc). Override
// only selectors that already declare a transition. `.01ms`, not `0s`/`none`:
// Slack's JS waits on `transitionend`, which a zero transition never fires.

const OVERRIDE = 'transition-duration: .01ms !important; transition-delay: 0s !important;';
/** Selectors per emitted rule. One unparseable selector voids its whole list. */
const CHUNK = 200;
const RESCAN_MS = 5_000;

function hasDuration(style: CSSStyleDeclaration): boolean {
  const duration = style.getPropertyValue('transition-duration');
  if (duration) return duration.includes('var(') || duration.split(',').some((part) => Number.parseFloat(part) > 0);
  // A shorthand built from var() leaves its longhands empty until computed.
  return style.getPropertyValue('transition').includes('var(');
}

function collect(rules: CSSRuleList, into: Set<string>) {
  for (const rule of rules) {
    if (rule instanceof CSSStyleRule && hasDuration(rule.style)) into.add(rule.selectorText);
    // @media, @supports, @layer and nested rules all carry cssRules.
    const nested = (rule as CSSGroupingRule).cssRules;
    if (nested) collect(nested, into);
  }
}

export type TransitionOverride = { stop(): void };

// Each batch gets its own key, so later batches add a sheet instead of
// re-parsing earlier ones.
export function overrideTransitions(emit: (css: string, key: string) => void): TransitionOverride {
  const known = new Set<string>();
  /** Rule count per sheet at its last scan; a change means Slack inserted rules. */
  const scanned = new WeakMap<CSSStyleSheet, number>();
  let batch = 0;
  let scans = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let stopped = false;

  const scan = () => {
    const found = new Set<string>();
    for (const sheet of document.styleSheets) {
      const owner = sheet.ownerNode as HTMLElement | null;
      if (owner?.dataset?.slickStyle !== undefined) continue;
      let rules: CSSRuleList;
      try {
        rules = sheet.cssRules;
      } catch {
        continue; // cross-origin without CORS
      }
      if (scanned.get(sheet) === rules.length) continue;
      scanned.set(sheet, rules.length);
      collect(rules, found);
    }

    const fresh = [...found].filter((selector) => !known.has(selector));
    if (!fresh.length) return;
    for (const selector of fresh) known.add(selector);

    const css: string[] = [];
    for (let i = 0; i < fresh.length; i += CHUNK) css.push(`${fresh.slice(i, i + CHUNK).join(',\n')} { ${OVERRIDE} }`);
    emit(css.join('\n'), `transitions:${batch++}`);
  };

  const loop = () => {
    if (stopped) return;
    try {
      scan();
    } catch (error) {
      console.error('[slick] [Snappy] transition scan failed:', error);
    }
    // Fast while Slack loads its stylesheets, then rarely; idle time only.
    const delay = ++scans < 10 ? 1_000 : RESCAN_MS;
    timer = setTimeout(() => requestIdleCallback(loop, { timeout: delay }), delay);
  };
  loop();

  return {
    stop() {
      stopped = true;
      clearTimeout(timer);
    },
  };
}
