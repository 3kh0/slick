// Collapse Slack's transitions without touching elements that have none.
//
// The obvious rule -- `.p-client_container * { transition-duration: .01ms }` --
// is what Snappy used to ship, and it was the single most expensive thing in
// Slick. Declaring any transition longhand on an element gives it a transition
// with `transition-property: all`, so Chromium diffs every property of every
// element on every style recalc. Measured on a signed-in client, that rule
// alone doubled style-recalc time during a window drag and quadrupled it while
// switching views (4.4s -> 1.1s over the nav benchmark once removed).
//
// Instead, read Slack's own stylesheets and override only the selectors that
// already declare a transition. Elements that never animated stay untouched.
// `.01ms` rather than `none` or `0s`: Slack's JS waits on `transitionend` in
// places, and a transition that never runs never fires it.

const OVERRIDE = 'transition-duration: .01ms !important; transition-delay: 0s !important;';
/** Selectors per emitted rule. One unparseable selector voids its whole list. */
const CHUNK = 200;
/** How often to look for rules Slack inserted since the last scan. */
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

/**
 * `emit(css, key)` receives each new batch of overrides under its own key, so
 * a later batch adds a sheet rather than re-parsing the ones before it.
 */
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
    // Quickly at first, while Slack is still loading its stylesheets, then
    // rarely. Idle time only: this is housekeeping, never worth a dropped frame.
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
