'use strict';
const fs = require('fs');
const path = require('path');

module.exports = {
  meta: {
    name: 'PrivateChannelMapper',
    description: 'Show IDs of private channels you can’t see, and double-click to name them',
  },

  renderer: fs.readFileSync(path.join(__dirname, 'renderer.js'), 'utf8'),
};
