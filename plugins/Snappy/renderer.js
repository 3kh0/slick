(function () {
  'use strict';

  const existing = window.__slickSnappy;
  if (existing) {
    existing.apply();
    return;
  }

  const SELECTOR =
    '.p-message_input__input_container_unstyled[contenteditable="true"], ' +
    '.p-message_input__input_container_unstyled [contenteditable="true"]';
  const originals = new WeakMap();
  const changed = new Set();

  function disabled() {
    return window.__slickPluginSettings?.Snappy?.disableSpellcheck === true;
  }

  function editors(root = document) {
    const found = [];
    if (root.nodeType === Node.ELEMENT_NODE && root.matches(SELECTOR)) found.push(root);
    if (root.querySelectorAll) found.push(...root.querySelectorAll(SELECTOR));
    return found;
  }

  function disable(editor) {
    if (!originals.has(editor)) originals.set(editor, editor.getAttribute('spellcheck'));
    editor.setAttribute('spellcheck', 'false');
    changed.add(editor);
  }

  function restore(editor) {
    if (!originals.has(editor)) return;
    const original = originals.get(editor);
    if (original === null) editor.removeAttribute('spellcheck');
    else editor.setAttribute('spellcheck', original);
    originals.delete(editor);
    changed.delete(editor);
  }

  function prune() {
    for (const editor of changed) {
      if (editor.isConnected) continue;
      originals.delete(editor);
      changed.delete(editor);
    }
  }

  function apply(root) {
    if (disabled()) {
      for (const editor of editors(root)) disable(editor);
      return;
    }
    for (const editor of changed) restore(editor);
  }

  const observer = new MutationObserver((mutations) => {
    if (!disabled()) return;
    prune();
    for (const mutation of mutations) for (const node of mutation.addedNodes) apply(node);
  });
  observer.observe(document.body, { childList: true, subtree: true });

  const state = (window.__slickSnappy = { apply: () => apply(document), observer });
  window.addEventListener('slick:plugin-settings', state.apply);
  state.apply();
})();
