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
const MAX_RECHECK_MS = 240_000;

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
  const held = new Map<CSSStyleSheet, { links: Element[]; layer: HTMLStyleElement | null }>();
  let stopped = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let idle: number | undefined;
  let work: Generator<void, boolean> | undefined;
  let interval = RECHECK_MS;
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
  const scan = function* (): Generator<void, boolean> {
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
    const before = new Set(held.keys());
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
      held.set(sheet, { links: [owner(sheet)!, owner(last)!], layer: prelude ? layer : null });
    }
    return held.size !== before.size || [...held.keys()].some((sheet) => !before.has(sheet));
  };
  const schedule = () => {
    idle = requestIdleCallback(step, { timeout: 1_000 });
  };
  const step = (deadline: IdleDeadline) => {
    idle = undefined;
    if (stopped) return;
    if (doc.hidden) {
      timer = setTimeout(schedule, interval);
      return;
    }
    work ??= scan();
    let result: IteratorResult<void, boolean>;
    const start = performance.now();
    try {
      do {
        result = work.next();
      } while (!result.done && performance.now() - start < 4 && deadline.timeRemaining() > 1);
    } catch (error) {
      release();
      console.error('[slick] [Snappy] duplicate stylesheet check failed:', error);
      result = { done: true, value: true };
    }
    if (!result.done) {
      schedule();
      return;
    }
    work = undefined;
    // Slack hasn't been seen editing its linked sheets through CSSOM, so back off while nothing changes.
    interval = result.value ? RECHECK_MS : Math.min(interval * 2, MAX_RECHECK_MS);
    timer = setTimeout(schedule, interval);
  };
  // Re-enabling a sheet rebuilds the rule index; release only pairs whose own links changed.
  const recheck = () => {
    if (stopped) return;
    interval = RECHECK_MS;
    work = undefined;
    clearTimeout(timer);
    if (idle !== undefined) cancelIdleCallback(idle);
    idle = undefined;
    timer = setTimeout(schedule, 1_000);
  };
  const stylesheets = (node: Node): Element[] =>
    node.nodeName === 'LINK'
      ? (node as HTMLLinkElement).relList.contains('stylesheet')
        ? [node as Element]
        : []
      : node instanceof Element
        ? [...node.querySelectorAll('link[rel~="stylesheet" i]')]
        : [];
  const observer = new MutationObserver((records) => {
    const changed = new Set<Element>();
    for (const record of records) {
      if (record.type === 'attributes') {
        if (record.attributeName === 'rel' || stylesheets(record.target).length) changed.add(record.target as Element);
      } else
        for (const node of [...record.addedNodes, ...record.removedNodes])
          for (const link of stylesheets(node)) changed.add(link);
    }
    if (!changed.size) return;
    for (const [sheet, entry] of held) if (entry.links.some((link) => changed.has(link))) restore(sheet);
    recheck();
  });
  observer.observe(doc.head, {
    subtree: true,
    childList: true,
    attributes: true,
    attributeFilter: ['href', 'media', 'rel', 'title', 'disabled'],
  });
  const onLoad = (event: Event) => {
    if (event.target instanceof Node && stylesheets(event.target).length) recheck();
  };
  doc.addEventListener('load', onLoad, true);
  timer = setTimeout(schedule, 1_000);
  return {
    stop() {
      stopped = true;
      observer.disconnect();
      doc.removeEventListener('load', onLoad, true);
      clearTimeout(timer);
      if (idle !== undefined) cancelIdleCallback(idle);
      work = undefined;
      release();
    },
  };
}
