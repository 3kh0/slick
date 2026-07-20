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
  let unsubscribe = null;

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

  function apply(root = document) {
    for (const editor of editors(root)) disable(editor);
  }

  function sync() {
    if (disabled()) {
      if (!unsubscribe) {
        unsubscribe = window.__slickDOM.onRootsSync((added) => {
          prune();
          for (const node of added) apply(node);
        });
      }
      apply();
      return;
    }

    unsubscribe?.();
    unsubscribe = null;
    for (const editor of changed) restore(editor);
  }

  const state = (window.__slickSnappy = { apply: sync });
  window.addEventListener('slick:plugin-settings', state.apply);
  state.apply();
})();
