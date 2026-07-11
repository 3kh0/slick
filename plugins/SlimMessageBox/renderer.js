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
  function applyDomHides() {
    var s = settings();
    for (var key in HIDE_DOM) {
      if (!s[key]) continue;
      document.querySelectorAll(SCOPE + ' ' + HIDE_DOM[key]).forEach(function (el) {
        el.style.setProperty('display', 'none', 'important');
      });
    }
  }
  function scanAll() {
    document
      .querySelectorAll(SCOPE + ' .ql-editor, ' + SCOPE + ' [contenteditable="true"][role="textbox"]')
      .forEach(evaluate);
    applyDomHides();
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
  new MutationObserver(function () {
    if (pending) return;
    pending = true;
    setTimeout(function () {
      pending = false;
      scanAll();
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
