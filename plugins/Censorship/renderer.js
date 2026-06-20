(function () {
  'use strict';

  var existing = window.__slickCensorship;
  if (existing) {
    existing.apply();
    return;
  }

  var SKIP_TAGS = {
    SCRIPT: true,
    STYLE: true,
    TEXTAREA: true,
    INPUT: true,
    SELECT: true,
    OPTION: true,
    CODE: true,
    PRE: true,
    KBD: true,
    SAMP: true,
    NOSCRIPT: true,
    IFRAME: true,
    CANVAS: true,
    SVG: true,
  };

  var originals = new WeakMap();
  var lastMasked = new WeakMap();
  var changed = new Set();
  var matcher = null;
  var style = 'stars';
  var replacement = 'uwu';
  var applying = false;

  function settings() {
    return (window.__slickPluginSettings && window.__slickPluginSettings.Censorship) || {};
  }

  function esc(value) {
    return String(value).replace(/[\\^$.*+?()[\]{}|]/g, '\\$&');
  }

  function isWordChar(value) {
    return /[\p{L}\p{N}_]/u.test(value);
  }

  function splitTerms(value) {
    return String(value || '')
      .split(/[\n,]/)
      .map(function (term) {
        return term.trim();
      })
      .filter(Boolean)
      .toSorted(function (a, b) {
        return b.length - a.length;
      });
  }

  function termPattern(term) {
    var pattern = term.split(/\s+/).map(esc).join('\\s+');
    if (isWordChar(term[0])) pattern = '(?<![\\p{L}\\p{N}_])' + pattern;
    if (isWordChar(term[term.length - 1])) pattern += '(?![\\p{L}\\p{N}_])';
    return pattern;
  }

  function compile() {
    var cfg = settings();
    var terms = splitTerms(cfg.terms);
    style = String(cfg.style);
    replacement = String(cfg.replacement) || 'uwu';

    if (!terms.length) {
      matcher = null;
      return;
    }

    try {
      matcher = new RegExp(terms.map(termPattern).join('|'), 'giu');
    } catch (e) {
      matcher = null;
    }
  }

  function repeated(match, char) {
    return match.replace(/\S/g, char);
  }

  function mask(match) {
    if (style === 'hashtags') return repeated(match, '#');
    if (style === 'blocks') return repeated(match, '█');
    if (style === 'custom') return replacement;
    return repeated(match, '*');
  }

  function censor(value) {
    if (!matcher) return value;
    matcher.lastIndex = 0;
    return String(value).replace(matcher, mask);
  }

  function shouldSkip(node) {
    var parent = node && node.parentElement;
    if (!parent || SKIP_TAGS[parent.tagName]) return true;
    if (parent.closest('[contenteditable="true"], #slick-panel-overlay, #slick-config-backdrop')) return true;
    return false;
  }

  function restore(node) {
    if (!originals.has(node)) return;
    applying = true;
    node.nodeValue = originals.get(node);
    applying = false;
    originals.delete(node);
    lastMasked.delete(node);
    changed.delete(node);
  }

  function applyText(node) {
    if (!node || node.nodeType !== Node.TEXT_NODE) return;
    if (shouldSkip(node) || !matcher) {
      restore(node);
      return;
    }

    var original = originals.get(node);
    if (original === undefined) {
      original = node.nodeValue || '';
    } else if (node.nodeValue !== lastMasked.get(node)) {
      original = node.nodeValue || '';
      originals.set(node, original);
    }

    var next = censor(original);
    if (next === original) {
      restore(node);
      return;
    }

    originals.set(node, original);
    lastMasked.set(node, next);
    changed.add(node);
    if (node.nodeValue !== next) {
      applying = true;
      node.nodeValue = next;
      applying = false;
    }
  }

  function walk(root) {
    if (!root) return;
    if (root.nodeType === Node.TEXT_NODE) {
      applyText(root);
      return;
    }
    if (root.nodeType !== Node.ELEMENT_NODE && root.nodeType !== Node.DOCUMENT_NODE) return;
    if (root.nodeType === Node.ELEMENT_NODE && SKIP_TAGS[root.tagName]) return;

    var walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
      acceptNode: function (node) {
        return shouldSkip(node) ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT;
      },
    });
    var node;
    while ((node = walker.nextNode())) applyText(node);
  }

  function prune() {
    changed.forEach(function (node) {
      if (node.isConnected) return;
      originals.delete(node);
      lastMasked.delete(node);
      changed.delete(node);
    });
  }

  function apply(root) {
    compile();
    if (!matcher) {
      changed.forEach(restore);
      return;
    }
    prune();
    walk(root || document.body || document);
  }

  var observer = new MutationObserver(function (mutations) {
    if (applying) return;
    compile();
    if (!matcher) {
      changed.forEach(restore);
      return;
    }
    prune();
    mutations.forEach(function (mutation) {
      if (mutation.type === 'characterData') applyText(mutation.target);
      mutation.addedNodes.forEach(walk);
    });
  });

  var root = document.body || document.documentElement;
  if (root) observer.observe(root, { childList: true, subtree: true, characterData: true });

  var state = (window.__slickCensorship = {
    apply: function () {
      apply(document.body || document);
    },
    observer: observer,
  });
  window.addEventListener('slick:plugin-settings', state.apply);
  state.apply();
})();
