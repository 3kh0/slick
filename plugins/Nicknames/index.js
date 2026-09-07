'use strict';
const fs = require('fs');
const path = require('path');

module.exports = {
  meta: {
    name: 'Nicknames',
    description: 'Set local nicknames for users',
  },

  // The early runtime replaces this renderer's name patching, but the renderer
  // also owns the profile-menu nickname editor, so it must still load.
  earlyCoexist: true,

  renderer: fs.readFileSync(path.join(__dirname, 'renderer.js'), 'utf8'),
};
