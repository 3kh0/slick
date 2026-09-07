'use strict';

const legacy = require('../../plugins/SilentTyping');

module.exports = {
  id: 'SilentTyping',
  description: legacy.meta.description,
  defaultEnabled: false,
  settings: {},
  setup: function setup(api) {
    // The websocket patch has to exist before Slack opens its first socket, so
    // the early runtime installs it instead of racing dom-ready.
    api.installed(
      api.net.socket((data) => {
        if (typeof data !== 'string' || !data.includes('typing')) return;
        try {
          const type = JSON.parse(data).type;
          if (type !== 'typing' && type !== 'user_typing') return;
        } catch {
          return;
        }
        api.count('dropped');
        return null;
      }),
    );
  },
};
