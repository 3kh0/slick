'use strict';

const fs = require('fs');
const path = require('path');

module.exports = {
  meta: {
    name: 'NotShitMarkdown',
    description: 'Make the composer use normal Markdown instead of Slack markup',
  },

  renderer: fs.readFileSync(path.join(__dirname, 'renderer.js'), 'utf8'),
};
