'use strict';

const legacy = require('../../plugins/CustomFonts');

// The uploaded-font-file setting needs a privileged file read and a custom
// protocol handler, so it stays on the desktop legacy path; the system-font
// family is the part that ports to every platform.
module.exports = {
  id: 'CustomFonts',
  description: legacy.meta.description,
  defaultEnabled: false,
  settings: { fontFamily: legacy.settings.fontFamily },
  probe: function probe(diagnostics) {
    return diagnostics.capabilities.style === true;
  },
  setup: function setup(api) {
    const style = api.style('slick-early-fonts');
    const quote = (value) => `"${String(value).replace(/(["\\])/g, '\\$1')}"`;
    function apply() {
      const family = api.enabled ? String(api.settings.fontFamily || '').trim() : '';
      if (!family) return style.set('');
      const stack = `${quote(family)},var(--font-family-fallback)`;
      style.set(`body{--font-family-default:${stack};--font-family-lato:${stack};font-family:${stack}!important;}`);
    }
    api.subscribe(apply);
    api.ready(() => {
      apply();
      api.installed(true);
    });
    apply();
  },
};
