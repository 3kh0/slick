'use strict';
(() => {
  if (window.__slickDOM) return;

  const rootSubs = []; // { fn, charData }
  const tickSubs = []; // { fn, charData }
  const syncSubs = []; // fn
  const attrSubs = []; // { fn, filter: Set }

  const addedRoots = new Set();
  const charRoots = new Set();
  let attrHits = []; // { target, name }
  let sawChildList = false;
  let sawCharData = false;

  let observer = null;
  let wantCharData = false;
  const attrFilter = new Set();

  const stats = {
    records: 0,
    flushes: 0,
    get subscribers() {
      return { roots: rootSubs.length, ticks: tickSubs.length, sync: syncSubs.length, attrs: attrSubs.length };
    },
  };

  // Collapse-contained dedup: keep only ancestors so subscribers scan each subtree once.
  function queue(set, node) {
    for (const pending of set) {
      if (pending === node || pending.contains(node)) return;
      if (node.contains(pending)) set.delete(pending);
    }
    set.add(node);
  }

  function safeCall(fn, arg) {
    try {
      fn(arg);
    } catch (e) {
      console.error('[slick-dom-hub] subscriber threw:', e);
    }
  }

  let timer = 0;
  function flush() {
    timer = 0;
    stats.flushes++;
    const roots = [...addedRoots].filter((el) => el.isConnected);
    const chars = [...charRoots].filter((el) => el.isConnected);
    const hadChildList = sawChildList;
    const hadCharData = sawCharData;
    const attrs = attrHits;
    addedRoots.clear();
    charRoots.clear();
    attrHits = [];
    sawChildList = sawCharData = false;

    let withChars = null;
    for (const sub of rootSubs) {
      let list = roots;
      if (sub.charData && chars.length) {
        if (!withChars) {
          withChars = [...roots];
          for (const el of chars) {
            if (!withChars.some((root) => root === el || root.contains(el))) withChars.push(el);
          }
        }
        list = withChars;
      }
      if (list.length) safeCall(sub.fn, list);
    }
    for (const sub of tickSubs) {
      if (hadChildList || (sub.charData && hadCharData)) safeCall(sub.fn);
    }
    if (attrs.length) {
      for (const sub of attrSubs) {
        const targets = [...new Set(attrs.filter((a) => sub.filter.has(a.name)).map((a) => a.target))].filter(
          (t) => t.isConnected,
        );
        if (targets.length) safeCall(sub.fn, targets);
      }
    }
  }

  function onMutations(mutations) {
    stats.records += mutations.length;
    let syncAdded = null;
    for (const mutation of mutations) {
      if (mutation.type === 'characterData') {
        sawCharData = true;
        const el = mutation.target.parentElement;
        if (el) queue(charRoots, el);
        continue;
      }
      if (mutation.type === 'attributes') {
        attrHits.push({ target: mutation.target, name: mutation.attributeName });
        continue;
      }
      sawChildList = true;
      for (const node of mutation.addedNodes) {
        if (node.nodeType !== Node.ELEMENT_NODE) continue;
        queue(addedRoots, node);
        if (syncSubs.length) (syncAdded || (syncAdded = [])).push(node);
      }
      // Removal-only records: hand subscribers the parent so removals stay visible.
      if (mutation.removedNodes.length && mutation.target.nodeType === Node.ELEMENT_NODE) {
        queue(addedRoots, mutation.target);
      }
    }
    if (syncAdded) for (const fn of syncSubs) safeCall(fn, syncAdded);
    if (!timer && (addedRoots.size || charRoots.size || attrHits.length || sawChildList || sawCharData)) {
      timer = setTimeout(flush, 150);
    }
  }

  // Re-observing the same target replaces the options (spec) and keeps pending records.
  function observe() {
    if (!observer) observer = new MutationObserver(onMutations);
    const opts = { childList: true, subtree: true };
    if (wantCharData) opts.characterData = true;
    if (attrFilter.size) {
      opts.attributes = true;
      opts.attributeFilter = [...attrFilter];
    }
    observer.observe(document.documentElement, opts);
  }

  function stopIfIdle() {
    if (rootSubs.length || tickSubs.length || syncSubs.length || attrSubs.length) return;
    observer?.disconnect();
    clearTimeout(timer);
    timer = 0;
    addedRoots.clear();
    charRoots.clear();
    attrHits = [];
    sawChildList = sawCharData = false;
  }

  window.__slickDOM = {
    onRoots(fn, opts) {
      rootSubs.push({ fn, charData: !!(opts && opts.charData) });
      if (opts && opts.charData) wantCharData = true;
      observe();
    },
    onTick(fn, opts) {
      tickSubs.push({ fn, charData: !!(opts && opts.charData) });
      if (opts && opts.charData) wantCharData = true;
      observe();
    },
    onRootsSync(fn) {
      syncSubs.push(fn);
      observe();
      let active = true;
      return () => {
        if (!active) return;
        active = false;
        const index = syncSubs.indexOf(fn);
        if (index !== -1) syncSubs.splice(index, 1);
        stopIfIdle();
      };
    },
    onAttr(fn, filter) {
      attrSubs.push({ fn, filter: new Set(filter) });
      for (const name of filter) attrFilter.add(name);
      observe();
    },
    stats,
  };
})();
