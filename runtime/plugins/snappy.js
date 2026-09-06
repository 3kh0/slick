'use strict';

const legacy = require('../../plugins/Snappy');

// The GPU-blocklist and crash-reporter settings are Chromium switches applied by
// the desktop main process; only the renderer-side behaviour ports here.
module.exports = {
  id: 'Snappy',
  description: legacy.meta.description,
  defaultEnabled: true,
  settings: { disableSpellcheck: legacy.settings.disableSpellcheck },
  assets: { css: legacy.css },
  probe: function probe(diagnostics) {
    return diagnostics.capabilities.style === true;
  },
  setup: function setup(api) {
    const SELECTOR =
      '.p-message_input__input_container_unstyled[contenteditable="true"], ' +
      '.p-message_input__input_container_unstyled [contenteditable="true"]';
    const style = api.style('slick-early-snappy');
    const originals = new WeakMap();
    const changed = new Set();
    const wanted = () => api.enabled && api.settings.disableSpellcheck === true;
    function restore(editor) {
      if (!originals.has(editor)) return;
      const original = originals.get(editor);
      if (original === null) editor.removeAttribute('spellcheck');
      else editor.setAttribute('spellcheck', original);
      originals.delete(editor);
      changed.delete(editor);
    }
    function disable(editor) {
      if (!originals.has(editor)) originals.set(editor, editor.getAttribute('spellcheck'));
      editor.setAttribute('spellcheck', 'false');
      changed.add(editor);
    }
    function sync() {
      style.set(api.enabled ? api.assets.css : '');
      if (!wanted()) {
        for (const editor of Array.from(changed)) restore(editor);
        return;
      }
      // Editors that already exist are not re-announced by the shared observer.
      if (typeof document !== 'undefined' && document.documentElement)
        for (const editor of document.querySelectorAll(SELECTOR)) disable(editor);
    }
    api.subscribe(sync);
    api.ready(() => {
      api.dom.elements(
        SELECTOR,
        (editor) => {
          if (wanted()) disable(editor);
        },
        (editor) => changed.delete(editor),
      );
      sync();
      api.installed(true);
    });
  },
};
