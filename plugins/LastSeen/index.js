'use strict';

const fs = require('fs');
const path = require('path');

module.exports = {
  meta: {
    name: 'LastSeen',
    description: 'Show a "last seen" time for other people, based on what your client can observe.',
  },

  settings: {
    showLastMessage: {
      type: 'boolean',
      label: 'Show last message',
      description: 'Look up the most recent message you can see from this person.',
      default: true,
    },
    showObservedPresence: {
      type: 'boolean',
      label: 'Show observed presence',
      description: 'Show roughly when we last saw them flip status, based only on presence events seen.',
      default: true,
    },
    trackWatchlist: {
      type: 'boolean',
      label: 'Track opened profiles',
      description:
        'Subscribe to presence for people whose profiles you open, so we keep track of them. Use a little extra websocket traffic.',
      default: false,
    },
    cacheTtlHours: {
      type: 'number',
      label: 'Cache lifetime (hours)',
      description: 'How long to keep cached last-message lookups and observed data before refreshing/evicting.',
      default: 168,
    },
  },

  renderer: fs.readFileSync(path.join(__dirname, 'renderer.js'), 'utf8'),
};
