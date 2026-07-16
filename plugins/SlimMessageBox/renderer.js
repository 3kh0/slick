(() => {
  var DIR = 'SlimMessageBox';
  var SCOPE = '.p-message_input__input_container_unstyled';
  var TEXTY_BUTTON_HIDE_MAP = {
    hideFormatting: { prop: 'enableComposerButton', value: false },
    hideEmoji: { prop: 'enableEmojiButton', value: false },
    hideMention: { prop: 'enableMentionButton', value: false },
    hideVideo: { prop: 'enableStoryButton', value: false },
    hideAudio: { prop: 'enableAudioButton', value: false },
    hideSlash: [
      { prop: 'enableSlashCommandsButton', value: false },
      { prop: 'enableShortcutsButton', value: false },
    ],
  };
  var THREAD_FOOTER_HIDE_MAP = {
    hideBroadcast: { prop: 'dontShowBroadcastControls', value: true },
  };
  var HIDE_DOM = {
    hideSlash: 'button[aria-label="Run shortcut"],.c-texty_buttons--overflow',
    hideBroadcast: '.p-threads_footer__input_container__broadcast_controls',
  };

  function settings() {
    return (window.__slickPluginSettings || {})[DIR] || {};
  }

  function isMultiline(editor) {
    var cs = getComputedStyle(editor);
    var lineHeight = parseFloat(cs.lineHeight) || parseFloat(cs.fontSize) * 1.4;
    var padding = parseFloat(cs.paddingTop) + parseFloat(cs.paddingBottom);
    return editor.scrollHeight - padding > lineHeight * 1.6;
  }

  function hasAttachments(scope) {
    return !!scope.querySelector(
      '.c-wysiwyg_container__attachments, .p-message_input__attachments, .c-pending_files, .c-message__editor__composer_attachments',
    );
  }
  function evaluate(editor) {
    var scope = editor.closest(SCOPE);
    if (!scope) return;
    var enabled = settings().discordLayout !== false; // def on
    if (enabled && (isMultiline(editor) || hasAttachments(scope))) {
      scope.classList.add('slick-smb-stacked');
    } else {
      scope.classList.remove('slick-smb-stacked');
    }
  }
  function applyDomHides(root) {
    var s = settings();
    for (var key in HIDE_DOM) {
      if (!s[key]) continue;
      var insideScope = root.nodeType === Node.ELEMENT_NODE && root.closest(SCOPE);
      var selector = insideScope ? HIDE_DOM[key] : SCOPE + ' ' + HIDE_DOM[key];
      var elements = [];
      if (root.nodeType === Node.ELEMENT_NODE && root.matches(selector)) elements.push(root);
      if (root.querySelectorAll) elements.push.apply(elements, root.querySelectorAll(selector));
      elements.forEach(function (el) {
        el.style.setProperty('display', 'none', 'important');
      });
    }
  }
  function scan(root) {
    var selector = SCOPE + ' .ql-editor, ' + SCOPE + ' [contenteditable="true"][role="textbox"]';
    var editors = [];
    if (root.nodeType === Node.ELEMENT_NODE && root.matches(selector)) editors.push(root);
    if (root.querySelectorAll) editors.push.apply(editors, root.querySelectorAll(selector));
    editors.forEach(evaluate);
    var scope = root.nodeType === Node.ELEMENT_NODE && root.closest(SCOPE);
    if (scope) scope.querySelectorAll('.ql-editor,[contenteditable="true"][role="textbox"]').forEach(evaluate);
    applyDomHides(root);
  }
  function scanAll() {
    scan(document);
  }
  document.addEventListener(
    'input',
    function (e) {
      var t = e.target;
      if (
        t &&
        t.classList &&
        (t.classList.contains('ql-editor') || (t.getAttribute && t.getAttribute('role') === 'textbox'))
      ) {
        evaluate(t);
      }
    },
    true,
  );
  window.addEventListener('resize', scanAll);
  window.addEventListener('slick:plugin-settings', scanAll);
  var pending = false;
  var pendingRoots = new Set();
  function queue(root) {
    if (!root || root.nodeType !== Node.ELEMENT_NODE) return;
    for (var existing of pendingRoots) {
      if (existing.contains(root)) return;
      if (root.contains(existing)) pendingRoots.delete(existing);
    }
    pendingRoots.add(root);
  }
  new MutationObserver(function (mutations) {
    mutations.forEach(function (mutation) {
      queue(mutation.target.closest && mutation.target.closest(SCOPE));
      mutation.addedNodes.forEach(queue);
    });
    if (!pendingRoots.size) return;
    if (pending) return;
    pending = true;
    setTimeout(function () {
      pending = false;
      var roots = Array.from(pendingRoots);
      pendingRoots.clear();
      roots.forEach(scan);
    }, 150);
  }).observe(document.documentElement, { childList: true, subtree: true });
  scanAll();

  // uses internals for button hiding
  function overrides(map) {
    var s = settings();
    var out = null;
    for (var key in map) {
      if (!s[key]) continue;
      var rules = map[key];
      if (!Array.isArray(rules)) rules = [rules];
      for (var i = 0; i < rules.length; i++) {
        out = out || {};
        out[rules[i].prop] = rules[i].value;
      }
    }
    return out;
  }
  var PATCH_TARGETS = [
    ['TextyButtons', TEXTY_BUTTON_HIDE_MAP],
    ['WysiwygContainer', TEXTY_BUTTON_HIDE_MAP],
    ['MessageInput', TEXTY_BUTTON_HIDE_MAP],
    ['ThreadFooter', THREAD_FOOTER_HIDE_MAP],
  ];
  var tries = 0;
  (function waitForInternals() {
    var internals = window.__slickInternals;
    if (internals && internals.react && internals.react.patchProps) {
      for (var i = 0; i < PATCH_TARGETS.length; i++) {
        (function (name, map) {
          internals.react.patchProps(name, function (props) {
            var o = overrides(map);
            return o ? Object.assign({}, props, o) : props;
          });
        })(PATCH_TARGETS[i][0], PATCH_TARGETS[i][1]);
      }
      window.addEventListener('slick:plugin-settings', function () {
        internals.react.refresh();
      });
      console.log('[SlimMessageBox] active');
      return;
    }
    if (tries++ > 100) {
      console.error('[SlimMessageBox] internals unavailable!');
      return;
    }
    setTimeout(waitForInternals, 100);
  })();
})();
