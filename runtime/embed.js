'use strict';

// Build-time host for a legacy renderer IIFE. Node creates a real function
// whose source is serialized into the page bundle with the rest of the runtime.
// That is the same mechanism as descriptor `setup.toString()`, not page-world
// eval: Slack CSP continues to block `eval` / `new Function` in the document.
//
// The renderer runs immediately when `document` exists (document_start), so
// fetch/WebSocket/iframe patches land before Slack captures them. In host-less
// Node tests without a document, installation waits for `api.ready`.

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
  if (!api.enabled) return '';
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
function runRenderer() {
  pluginSettings();
  try {
${rendererText}
    api.installed(true);
  } catch (e) {
    api.fail(e);
  }
  sync();
}
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
