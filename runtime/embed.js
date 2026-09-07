'use strict';

// Build-time host for a legacy renderer IIFE. Node creates a real function
// whose source is serialized into the page bundle with the rest of the runtime.
// That is the same mechanism as descriptor `setup.toString()`, not page-world
// eval: Slack CSP continues to block `eval` / `new Function` in the document.
//
// The renderer runs immediately when `document` exists (document_start), so
// fetch/WebSocket/iframe patches land before Slack captures them. In host-less
// Node tests without a document, installation waits for `api.ready`.
//
// A renderer's install is rarely over when its IIFE returns — most of them defer
// the real work (`if (!document.body) return setTimeout(boot, 200)`). So the
// renderer body runs inside `api.defer`, with the page's schedulers shadowed
// inside its scope: the plugin reports installed when its boot chain settles,
// and a throw from a deferred callback is blamed on the plugin instead of
// escaping as an uncaught page error. On failure the plugin hands itself back to
// the legacy path, which means dropping the `window.__slick<Name>` guard the
// dead attempt set — a legacy script returns at that guard and would otherwise
// leave the plugin doing nothing at all.

function sourceOf(value) {
  if (value == null) return '';
  return String(value);
}

function embed(opts) {
  const id = opts && opts.id;
  const rendererText = sourceOf(opts && opts.renderer);
  if (!id || !rendererText) throw new Error('embed() needs id and renderer source');
  const styleId = opts.styleId || `slick-early-${String(id).toLowerCase()}`;
  const cssIsFn = typeof opts.css === 'function';
  const cssFnText = cssIsFn ? opts.css.toString() : '';
  const cssText = !cssIsFn ? sourceOf(opts.css) : '';
  const settings = { ...opts.settings };
  delete settings.enabled;

  const setup = new Function(
    'api',
    `'use strict';
var style = api.style(${JSON.stringify(styleId)});
function pluginSettings() {
  if (typeof window === 'undefined') return;
  var root = window.__slickPluginSettings || (window.__slickPluginSettings = {});
  root[api.id] = api.settings;
  try {
    if (typeof CustomEvent === 'function') window.dispatchEvent(new CustomEvent('slick:plugin-settings'));
    else if (typeof Event === 'function') window.dispatchEvent(new Event('slick:plugin-settings'));
  } catch (e) {}
}
function cssText() {
  if (installFailed || !api.enabled) return '';
  ${
    cssIsFn
      ? `try {
    var out = (${cssFnText})(api.settings);
    return typeof out === 'string' ? out : '';
  } catch (e) {
    api.fail(e);
    return '';
  }`
      : 'return (api.assets && api.assets.css) || "";'
  }
}
function sync() {
  style.set(cssText());
  pluginSettings();
}
// The runtime's own page globals are never a renderer's guard.
var RUNTIME_GLOBALS = {
  __slickEarly: 1, __slickDOM: 1, __slickPluginSettings: 1, __slickDesktopEarly: 1,
  __slickBetaSend: 1, __slickInternals: 1, __slickPluginInstallContext: 1,
};
function slickGlobals() {
  var seen = {};
  try {
    var keys = Object.keys(window);
    for (var i = 0; i < keys.length; i++) if (keys[i].indexOf('__slick') === 0) seen[keys[i]] = true;
  } catch (e) {}
  return seen;
}
// Only what this renderer's own body added, measured the moment it returns:
// plugins install in sequence, so a later diff would sweep up the guards of
// every renderer that ran after this one.
function guardsAdded(before) {
  var mine = {};
  var seen = slickGlobals();
  for (var key in seen) if (!before[key] && !RUNTIME_GLOBALS[key]) mine[key] = true;
  return mine;
}
function dropGuards(mine) {
  for (var key in mine) {
    try {
      delete window[key];
    } catch (e) {}
  }
}
function runRenderer() {
  pluginSettings();
  var before = slickGlobals();
  var guards = {};
  var zone = api.defer({
    ready: function () {
      api.installed(true);
    },
    failed: function () {
      api.installed(false);
      installFailed = true;
      dropGuards(guards);
      sync();
    },
  });
  zone.run(function () {
    var setTimeout = zone.setTimeout;
    var clearTimeout = zone.clearTimeout;
    var setInterval = zone.setInterval;
    var clearInterval = zone.clearInterval;
    var queueMicrotask = zone.queueMicrotask;
    var requestAnimationFrame = zone.requestAnimationFrame;
    var requestIdleCallback = zone.requestIdleCallback;
    try {
${rendererText}
    } finally {
      guards = guardsAdded(before);
    }
  });
  sync();
}
var installFailed = false;
var started = false;
function tryStart() {
  sync();
  if (started || !api.enabled) return;
  if (typeof document === 'undefined') return;
  started = true;
  runRenderer();
}
api.subscribe(tryStart);
if (typeof document !== 'undefined') tryStart();
else api.ready(tryStart);
`,
  );

  return {
    id,
    description: opts.description || '',
    defaultEnabled: opts.defaultEnabled === true,
    settings,
    assets: cssText ? { css: cssText } : {},
    setup,
  };
}

module.exports = { embed };
