// Preserve named layer declarations at the original cascade position. Anonymous
// layers, imports, namespaces and unknown rules are deliberately not deduped.
const LEAVES = new Set([1, 5, 8]);
const NAMED_LEAVES = new Set(['CSSPropertyRule', 'CSSPositionTryRule', 'CSSNestedDeclarations']);
const GROUPS = new Set([
  'CSSMediaRule',
  'CSSSupportsRule',
  'CSSContainerRule',
  'CSSStartingStyleRule',
  'CSSKeyframesRule',
]);
const RECHECK_MS = 30_000;

export function* equivalentStyles(a: CSSRuleList, b: CSSRuleList, inStyle = false): Generator<void, string | null> {
  if (a.length !== b.length) return null;
  const prelude: string[] = [];
  for (let i = 0; i < a.length; i++) {
    const left = a[i];
    const right = b[i];
    const kind = left.constructor.name;
    if (left.type !== right.type || kind !== right.constructor.name) return null;
    const children = (left as CSSGroupingRule).cssRules;
    const otherChildren = (right as CSSGroupingRule).cssRules;
    if (kind === 'CSSLayerStatementRule') {
      if (inStyle || left.cssText !== right.cssText) return null;
      prelude.push(left.cssText);
    } else if (kind === 'CSSLayerBlockRule') {
      const name = (left as CSSLayerBlockRule).name;
      if (inStyle || !name || name !== (right as CSSLayerBlockRule).name || !otherChildren) return null;
      const nested = yield* equivalentStyles(children, otherChildren);
      if (nested === null) return null;
      prelude.push(nested ? `@layer ${name} { ${nested} }` : `@layer ${name};`);
    } else if (GROUPS.has(kind)) {
      // Compare group headers, then walk their children in slices. CSSOM may
      // still serialize a whole group when reading cssText.
      const text = left.cssText;
      const otherText = right.cssText;
      const header = text.slice(0, text.indexOf('{')).trim();
      const otherHeader = otherText.slice(0, otherText.indexOf('{')).trim();
      if (header !== otherHeader || !otherChildren) return null;
      const nested = yield* equivalentStyles(children, otherChildren, inStyle);
      if (nested === null) return null;
      if (nested) prelude.push(`${header} { ${nested} }`);
    } else if (LEAVES.has(left.type) || NAMED_LEAVES.has(kind)) {
      if (left.cssText !== right.cssText) return null;
      if (children?.length && (!otherChildren || (yield* equivalentStyles(children, otherChildren, true)) === null))
        return null;
    } else return null;
    yield;
  }
  return prelude.join('\n');
}

export function* equivalentRules(a: CSSRuleList, b: CSSRuleList): Generator<void, boolean> {
  return (yield* equivalentStyles(a, b)) !== null;
}

export function suppressDuplicateStyles(doc: Document = document) {
  const held = new Map<CSSStyleSheet, { last: CSSStyleSheet; layer: HTMLStyleElement | null }>();
  let stopped = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let idle: number | undefined;
  let work: Generator<void> | undefined;
  const owner = (sheet: CSSStyleSheet) => sheet.ownerNode as HTMLLinkElement | null;
  const restore = (sheet: CSSStyleSheet) => {
    // A disabled attribute added by Slack is its own state, not ours to undo.
    if (!owner(sheet)?.hasAttribute('disabled')) sheet.disabled = false;
    held.get(sheet)?.layer?.remove();
    held.delete(sheet);
  };
  const release = () => {
    for (const sheet of held.keys()) restore(sheet);
  };
  const key = (sheet: CSSStyleSheet) => {
    const link = owner(sheet);
    if (
      !link?.isConnected ||
      link.nodeName !== 'LINK' ||
      link.rel !== 'stylesheet' ||
      link.title ||
      !sheet.href ||
      link.hasAttribute('disabled')
    )
      return null;
    if (sheet.disabled && !held.has(sheet)) return null;
    return `${sheet.href}\n${sheet.media.mediaText}`;
  };
  const scan = function* (): Generator<void> {
    const groups = new Map<string, CSSStyleSheet[]>();
    for (const sheet of doc.styleSheets) {
      const identity = key(sheet);
      if (!identity) continue;
      const group = groups.get(identity) ?? [];
      group.push(sheet);
      groups.set(identity, group);
    }
    const next = new Map<CSSStyleSheet, { last: CSSStyleSheet; prelude: string }>();
    for (const group of groups.values()) {
      const last = group.at(-1)!;
      for (const sheet of group.slice(0, -1)) {
        try {
          const prelude = yield* equivalentStyles(sheet.cssRules, last.cssRules);
          if (prelude !== null) next.set(sheet, { last, prelude });
        } catch {
          /* Cross-origin or unloaded sheets stay enabled. */
        }
        yield;
      }
    }
    for (const sheet of held.keys()) if (!next.has(sheet)) restore(sheet);
    for (const [sheet, { last, prelude }] of next) {
      if (key(sheet) !== key(last) || last.disabled) continue;
      let layer = held.get(sheet)?.layer ?? null;
      if (prelude) {
        if (!layer) {
          layer = doc.createElement('style');
          layer.dataset.slickStyle = 'plugin:Snappy:duplicate-layers';
          layer.media = sheet.media.mediaText;
          owner(sheet)!.before(layer);
        }
        if (layer.textContent !== prelude) layer.textContent = prelude;
      } else layer?.remove();
      sheet.disabled = true;
      held.set(sheet, { last, layer: prelude ? layer : null });
    }
  };
  const schedule = () => {
    idle = requestIdleCallback(step, { timeout: 1_000 });
  };
  const step = (deadline: IdleDeadline) => {
    idle = undefined;
    if (stopped) return;
    if (doc.hidden) {
      timer = setTimeout(schedule, RECHECK_MS);
      return;
    }
    work ??= scan();
    let done = false;
    const start = performance.now();
    try {
      do {
        done = work.next().done === true;
      } while (!done && performance.now() - start < 4 && deadline.timeRemaining() > 1);
    } catch (error) {
      release();
      console.error('[slick] [Snappy] duplicate stylesheet check failed:', error);
      done = true;
    }
    if (!done) {
      schedule();
      return;
    }
    work = undefined;
    timer = setTimeout(schedule, RECHECK_MS);
  };
  const invalidate = () => {
    if (stopped) return;
    release();
    work = undefined;
    clearTimeout(timer);
    if (idle !== undefined) cancelIdleCallback(idle);
    timer = setTimeout(schedule, 1_000);
  };
  const hasLink = (node: Node) => node.nodeName === 'LINK' || (node instanceof Element && !!node.querySelector('link'));
  const observer = new MutationObserver((records) => {
    if (
      records.some((record) =>
        record.type === 'attributes'
          ? record.target.nodeName === 'LINK'
          : [...record.addedNodes, ...record.removedNodes].some(hasLink),
      )
    )
      invalidate();
  });
  observer.observe(doc.head, {
    subtree: true,
    childList: true,
    attributes: true,
    attributeFilter: ['href', 'media', 'rel', 'title', 'disabled'],
  });
  const onLoad = (event: Event) => {
    if ((event.target as Element)?.nodeName === 'LINK') invalidate();
  };
  const onVisibility = () => {
    if (!doc.hidden) invalidate();
  };
  doc.addEventListener('load', onLoad, true);
  doc.addEventListener('visibilitychange', onVisibility);
  timer = setTimeout(schedule, 1_000);
  return {
    stop() {
      stopped = true;
      observer.disconnect();
      doc.removeEventListener('load', onLoad, true);
      doc.removeEventListener('visibilitychange', onVisibility);
      clearTimeout(timer);
      if (idle !== undefined) cancelIdleCallback(idle);
      work = undefined;
      release();
    },
  };
}
