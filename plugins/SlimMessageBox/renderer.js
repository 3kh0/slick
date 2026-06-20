(() => {
  var DIR = 'SlimMessageBox';
  var SCOPE = '.p-message_input__input_container_unstyled';
  var HIDE_MAP = {
    hideFormatting: 'enableComposerButton',
    hideEmoji: 'enableEmojiButton',
    hideMention: 'enableMentionButton',
    hideVideo: 'enableStoryButton',
    hideAudio: 'enableAudioButton',
    hideSlash: 'enableSlashCommandsButton',
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
  function evaluate(editor) {
    var scope = editor.closest(SCOPE);
    if (!scope) return;
    var enabled = settings().discordLayout !== false; // def on
    if (enabled && isMultiline(editor)) scope.classList.add('slick-smb-stacked');
    else scope.classList.remove('slick-smb-stacked');
  }
  function scanAll() {
    document
      .querySelectorAll(SCOPE + ' .ql-editor, ' + SCOPE + ' [contenteditable="true"][role="textbox"]')
      .forEach(evaluate);
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
  function overrides() {
    var s = settings();
    var out = null;
    for (var key in HIDE_MAP) {
      if (s[key]) {
        out = out || {};
        out[HIDE_MAP[key]] = false;
      }
    }
    return out;
  }
  var tries = 0;
  (function waitForInternals() {
    var internals = window.__slickInternals;
    if (internals && internals.react && internals.react.patchProps) {
      internals.react.patchProps('TextyButtons', function (props) {
        var o = overrides();
        return o ? Object.assign({}, props, o) : props;
      });
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
