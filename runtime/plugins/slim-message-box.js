'use strict';

// Settings schema and layout CSS stay single-sourced in the legacy plugin so the
// desktop settings UI and the early runtime cannot drift apart.
const legacy = require('../../plugins/SlimMessageBox');

module.exports = {
  id: 'SlimMessageBox',
  description: legacy.meta.description,
  defaultEnabled: true,
  settings: legacy.settings,
  assets: { css: legacy.css({}) },
  probe: function probe(diagnostics) {
    return !!diagnostics.componentHits.TextyButtons;
  },
  setup: function setup(api) {
    const SCOPE = '.p-message_input__input_container_unstyled';
    const style = api.style('slick-early-composer');
    const scopes = new Map();
    const pending = new Set();
    let frame = 0;
    function evaluate(scope) {
      // Always measure in compact geometry. Measuring while stacked can produce
      // the opposite answer and oscillate when the layout changes editor width.
      scope.classList.remove('slick-smb-stacked');
      if (!api.enabled || api.settings.discordLayout === false) return;
      const attachments = scope.querySelector(
        '.c-wysiwyg_container__attachments,.p-message_input__attachments,.c-pending_files,.c-message__editor__composer_attachments',
      );
      const stacked =
        !!attachments ||
        [...scope.querySelectorAll('.ql-editor,[contenteditable="true"][role="textbox"]')].some((editor) => {
          const cs = getComputedStyle(editor);
          const lineHeight = parseFloat(cs.lineHeight) || parseFloat(cs.fontSize) * 1.4;
          const padding = (parseFloat(cs.paddingTop) || 0) + (parseFloat(cs.paddingBottom) || 0);
          return editor.scrollHeight - padding > lineHeight * 1.6;
        });
      if (stacked) scope.classList.add('slick-smb-stacked');
    }
    function flush() {
      frame = 0;
      for (const [scope, observers] of scopes) {
        if (scope.isConnected) continue;
        observers.forEach((observer) => observer.disconnect());
        scopes.delete(scope);
        pending.delete(scope);
      }
      const work = [...pending];
      pending.clear();
      for (const scope of work) {
        try {
          evaluate(scope);
        } catch (error) {
          api.fail(error);
        }
      }
    }
    function schedule(scope) {
      if (scope) pending.add(scope);
      if (!frame) frame = requestAnimationFrame(flush);
    }
    function track(scope) {
      if (scopes.has(scope)) return;
      // Composer width is the only geometry that matters: an editor-height
      // observer feeds its own stacked-layout change back into itself.
      let width;
      const resize = new ResizeObserver(([entry]) => {
        const next = entry.contentRect.width;
        if (next === width) return;
        width = next;
        schedule(scope);
      });
      resize.observe(scope);
      scopes.set(scope, [resize]);
      schedule(scope);
    }
    function updateStyle() {
      style.set(api.enabled && api.settings.discordLayout !== false ? api.assets.css : '');
      scopes.forEach((_observers, scope) => schedule(scope));
    }
    api.subscribe(updateStyle);
    api.ready(() => {
      updateStyle();
      // Draft DOM changes arrive through the shared observer; composer subtrees
      // are re-measured whenever anything inside them changes.
      api.dom.roots(
        (added, removed, targets) => {
          for (const node of added) {
            if (node.nodeType !== 1) continue;
            if (node.matches(SCOPE)) track(node);
            for (const found of node.querySelectorAll(SCOPE)) track(found);
          }
          // Re-measure only the composers a mutation actually touched. Insertions
          // and removals both land here through the record's target.
          if (!scopes.size) return;
          for (const target of targets) {
            const scope = target.nodeType === 1 ? target.closest?.(SCOPE) : target.parentElement?.closest?.(SCOPE);
            if (scope) schedule(scope);
          }
          // Detached composers are pruned by the next flush.
          if (removed.length) schedule();
        },
        { characterData: true },
      );
      window.addEventListener('resize', () => scopes.forEach((_observers, scope) => schedule(scope)));
      document.addEventListener(
        'input',
        (event) => {
          const scope = event.target.closest?.(SCOPE);
          if (scope) {
            track(scope);
            schedule(scope);
          }
        },
        true,
      );
      window.addEventListener('pagehide', () => {
        scopes.forEach((observers) => observers.forEach((observer) => observer.disconnect()));
        scopes.clear();
        pending.clear();
        cancelAnimationFrame(frame);
        frame = 0;
      });
      api.installed(true);
    });
    const buttons = {
      hideFormatting: 'enableComposerButton',
      hideEmoji: 'enableEmojiButton',
      hideMention: 'enableMentionButton',
      hideVideo: 'enableStoryButton',
      hideAudio: 'enableAudioButton',
    };
    function transform(props) {
      const settings = api.settings;
      let next = props;
      const set = (key, value) => {
        if (next === props) next = { ...props };
        next[key] = value;
      };
      for (const [setting, prop] of Object.entries(buttons)) if (settings[setting] === true) set(prop, false);
      if (settings.hideSlash === true) {
        set('enableSlashCommandsButton', false);
        set('enableShortcutsButton', false);
      }
      return next;
    }
    for (const name of ['TextyButtons', 'WysiwygContainer', 'MessageInput']) api.component(name, transform);
    api.component('ThreadFooter', (props) =>
      api.settings.hideBroadcast === true ? { ...props, dontShowBroadcastControls: true } : props,
    );
  },
};
