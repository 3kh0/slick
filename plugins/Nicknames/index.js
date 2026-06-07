'use strict';
const fs = require('fs');
const path = require('path');

module.exports = {
  meta: {
    name: 'Nicknames',
    description: 'Set local nicknames for users',
  },

  renderer: fs.readFileSync(path.join(__dirname, 'renderer.js'), 'utf8'),
};
