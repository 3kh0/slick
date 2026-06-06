'use strict';
const fs = require('fs');
const path = require('path');

module.exports = {
  meta: {
    name: 'SilentTyping',
    description: 'Hide that you are typing',
    version: '1.0.0',
  },

  renderer: fs.readFileSync(path.join(__dirname, 'renderer.js'), 'utf8'),
};
