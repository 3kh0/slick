'use strict';

const legacy = require('../../plugins/CustomSlackbot');

module.exports = {
  id: 'CustomSlackbot',
  description: legacy.meta.description,
  defaultEnabled: false,
  settings: {
    name: legacy.settings.name,
    url: legacy.settings.url,
    badge: legacy.settings.badge,
  },
  probe: function probe(diagnostics) {
    return diagnostics.capabilities.style === true;
  },
  setup: function setup(api) {
    const style = api.style('slick-early-custom-slackbot');
    function css() {
      if (!api.enabled) return '';
      const quote = (value) => JSON.stringify(String(value));
      const n = String(api.settings.name || '').trim();
      const a = String(api.settings.url || '').trim();
      return [
        a &&
          `.c-message_kit__background--labels--custom_response .c-message_kit__avatar { background-image: url(${quote(a)}) !important; }`,
        n &&
          `.c-message_kit__background--labels--custom_response .c-message__sender_button { font-size: 0 !important; }`,
        n &&
          `.c-message_kit__background--labels--custom_response .c-message__sender_button::after { content: ${quote(n)}; font-size: 15px; }`,
        api.settings.badge &&
          `.c-message_kit__background--labels--custom_response [data-qa="custom_response_info_badge"] { display: none !important; }`,
      ]
        .filter(Boolean)
        .join('\n');
    }
    function sync() {
      style.set(css());
      api.installed(true);
    }
    api.subscribe(sync);
    api.ready(sync);
    sync();
  },
};
