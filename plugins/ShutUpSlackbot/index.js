'use strict';

const fs = require('fs');
const path = require('path');

module.exports = {
  meta: {
    name: 'ShutUpSlackbot',
    description: 'Mark Slackbot slash-command registration DMs as read and silence their notifications.',
  },

  renderer: fs.readFileSync(path.join(__dirname, 'renderer.js'), 'utf8'),
};
