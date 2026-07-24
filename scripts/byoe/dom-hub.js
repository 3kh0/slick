'use strict';
(() => {
  if (window.__slickDOM) return;

  const rootSubs = []; // { fn, charData, plugin }
  const tickSubs = []; // { fn, charData, plugin }
  const syncSubs = []; // { fn, plugin }
  const attrSubs = []; // { fn, filter: Set, plugin }

  const addedRoots = new Set();
  const charRoots = new Set();
  let attrHits = []; // { target, name }
  let sawChildList = false;
  let sawCharData = false;

  let observer = null;
  let charObserver = null;
  let wantCharData = false;
  const attrFilter = new Set();
  const pluginStats = Object.create(null);

  const pluginName = (opts) =>
    String((opts && opts.plugin) || window.__slickPluginInstallContext || 'slick')
      .replace(/[^a-z0-9_-]/gi, '')
      .slice(0, 64) || 'slick';

  function metric(plugin) {
    return (
      pluginStats[plugin] ||
      (pluginStats[plugin] = {
        calls: 0,
        totalMs: 0,
        maxMs: 0,
        items: 0,
        errors: 0,
      })
    );
  }

  const stats = {
    records: 0,
    flushes: 0,
    get subscribers() {
      return { roots: rootSubs.length, ticks: tickSubs.length, sync: syncSubs.length, attrs: attrSubs.length };
    },
    plugins: pluginStats,
  };

  // Collapse-contained dedup: keep only ancestors so subscribers scan each subtree once.
  function queue(set, node) {
    for (const pending of set) {
      if (pending === node || pending.contains(node)) return;
      if (node.contains(pending)) set.delete(pending);
    }
    set.add(node);
  }

  function safeCall(sub, arg, items) {
    const started = performance.now();
    const item = metric(sub.plugin);
    try {
      sub.fn(arg);
    } catch (e) {
      item.errors++;
      console.error('[slick-dom-hub] subscriber threw:', e);
    } finally {
      const ms = performance.now() - started;
      item.calls++;
      item.totalMs += ms;
      item.maxMs = Math.max(item.maxMs, ms);
      item.items += items || 0;
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
      if (list.length) safeCall(sub, list, list.length);
    }
    for (const sub of tickSubs) {
      if (hadChildList || (sub.charData && hadCharData)) safeCall(sub, undefined, 1);
    }
    if (attrs.length) {
      for (const sub of attrSubs) {
        const targets = [...new Set(attrs.filter((a) => sub.filter.has(a.name)).map((a) => a.target))].filter(
          (t) => t.isConnected,
        );
        if (targets.length) safeCall(sub, targets, targets.length);
      }
    }
  }

  function onStructuralMutations(mutations) {
    stats.records += mutations.length;
    let syncAdded = null;
    for (const mutation of mutations) {
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
    if (syncAdded) for (const sub of syncSubs) safeCall(sub, syncAdded, syncAdded.length);
    if (!timer && (addedRoots.size || charRoots.size || attrHits.length || sawChildList || sawCharData)) {
      timer = setTimeout(flush, 150);
    }
  }

  function onCharacterMutations(mutations) {
    stats.records += mutations.length;
    sawCharData = true;
    for (const mutation of mutations) {
      const el = mutation.target.parentElement;
      if (el) queue(charRoots, el);
    }
    if (!timer) timer = setTimeout(flush, 150);
  }

  function observe() {
    if (!observer) observer = new MutationObserver(onStructuralMutations);
    const opts = { childList: true, subtree: true };
    if (attrFilter.size) {
      opts.attributes = true;
      opts.attributeFilter = [...attrFilter];
    }
    observer.observe(document.documentElement, opts);
    if (wantCharData) {
      if (!charObserver) charObserver = new MutationObserver(onCharacterMutations);
      charObserver.observe(document.documentElement, { characterData: true, subtree: true });
    }
  }

  function stopIfIdle() {
    if (rootSubs.length || tickSubs.length || syncSubs.length || attrSubs.length) return;
    observer?.disconnect();
    charObserver?.disconnect();
    clearTimeout(timer);
    timer = 0;
    addedRoots.clear();
    charRoots.clear();
    attrHits = [];
    sawChildList = sawCharData = false;
  }

  function unsubscribe(array, sub) {
    let active = true;
    return () => {
      if (!active) return;
      active = false;
      const index = array.indexOf(sub);
      if (index !== -1) array.splice(index, 1);
      if (sub.charData && !rootSubs.some((entry) => entry.charData) && !tickSubs.some((entry) => entry.charData)) {
        wantCharData = false;
        charObserver?.disconnect();
      }
      stopIfIdle();
    };
  }

  window.__slickDOM = {
    onRoots(fn, opts) {
      const sub = { fn, charData: !!(opts && opts.charData), plugin: pluginName(opts) };
      rootSubs.push(sub);
      if (opts && opts.charData) wantCharData = true;
      observe();
      return unsubscribe(rootSubs, sub);
    },
    onTick(fn, opts) {
      const sub = { fn, charData: !!(opts && opts.charData), plugin: pluginName(opts) };
      tickSubs.push(sub);
      if (opts && opts.charData) wantCharData = true;
      observe();
      return unsubscribe(tickSubs, sub);
    },
    onRootsSync(fn) {
      const sub = { fn, plugin: pluginName() };
      syncSubs.push(sub);
      observe();
      return unsubscribe(syncSubs, sub);
    },
    onAttr(fn, filter) {
      const sub = { fn, filter: new Set(filter), plugin: pluginName() };
      attrSubs.push(sub);
      for (const name of filter) attrFilter.add(name);
      observe();
      return unsubscribe(attrSubs, sub);
    },
    snapshot() {
      return {
        records: stats.records,
        flushes: stats.flushes,
        subscribers: stats.subscribers,
        plugins: Object.fromEntries(
          Object.entries(pluginStats).map(([name, item]) => [
            name,
            {
              calls: item.calls,
              totalMs: Math.round(item.totalMs * 100) / 100,
              maxMs: Math.round(item.maxMs * 100) / 100,
              items: item.items,
              errors: item.errors,
            },
          ]),
        ),
      };
    },
    stats,
  };
})();
