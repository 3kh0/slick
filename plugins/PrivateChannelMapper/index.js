'use strict';
const fs = require('fs');
const path = require('path');

module.exports = {
  meta: {
    name: 'PrivateChannelMapper',
    description: 'Name the private channels you can’t see, and mention the ones you are not in',
  },
  capabilities: ['internals'],
  renderer: fs.readFileSync(path.join(__dirname, 'renderer.js'), 'utf8'),
  settings: {
    flaron: {
      type: 'boolean',
      label: 'Use external private channel DB (Flaron)',
      description: 'If enabled, the plugin will show known private channel names if no local name is found.',
      default: false,
    },
    mentions: {
      type: 'boolean',
      label: 'Mention private channels you are not in',
      description:
        'Autocompletes #channel in the composer for private channels Slack hides from you. Sends the exact name you typed to Flaron to look the channel ID up.',
      default: false,
    },
  },
};
