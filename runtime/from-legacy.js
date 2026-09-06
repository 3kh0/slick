'use strict';

const { embed } = require('./embed');

// Wrap a plugins/<id> module as an early descriptor. Desktop `main()` keeps
// running through the BYOE loader; the early path owns the renderer/CSS so
// inject.js can skip the duplicate page script when the probe passes.
module.exports = function fromLegacy(id, extras = {}) {
  const legacy = require(`../plugins/${id}`);
  const settings = extras.settings || legacy.settings || {};
  return embed({
    id,
    description: (legacy.meta && legacy.meta.description) || '',
    defaultEnabled: extras.defaultEnabled === true,
    settings,
    css: extras.css !== undefined ? extras.css : legacy.css,
    renderer: extras.renderer !== undefined ? extras.renderer : legacy.renderer,
    styleId: extras.styleId,
  });
};
