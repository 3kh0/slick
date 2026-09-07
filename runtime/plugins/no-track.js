'use strict';

const legacy = require('../../plugins/NoTrack');

module.exports = {
  id: 'NoTrack',
  description: legacy.meta.description,
  defaultEnabled: true,
  settings: {},
  setup: function setup(api) {
    // Same endpoints the desktop loader blocks in the main process; patterns
    // originally taken from uAssets and the AdGuard filters.
    const BLOCKED = [
      /^[a-z]+:\/\/([^/?#]*\.)?slackb\.com(?:[/?#]|$)/i,
      /^[a-z]+:\/\/([^/?#]*\.)?slack\.com\/(beacon|clog)\//i,
    ];
    api.installed(
      api.net.request((request) => {
        let url = request.url;
        if (url.startsWith('//')) url = `https:${url}`;
        else if (url.startsWith('/')) {
          try {
            url = new URL(url, location.href).href;
          } catch {
            return;
          }
        }
        if (!BLOCKED.some((pattern) => pattern.test(url))) return;
        api.count('blocked');
        request.block();
      }),
    );
  },
};
