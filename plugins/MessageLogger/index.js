'use strict';

const fs = require('fs');
const path = require('path');

module.exports = {
  meta: {
    name: 'MessageLogger',
    description: 'Temporarily logs deleted and edited messages.',
  },

  settings: {
    deletedStyle: {
      type: 'select',
      label: 'Deleted style',
      description: 'How deleted messages should look',
      default: 'red',
      options: [
        { value: 'red', label: 'Red font' },
        { value: 'opacity', label: '50% opacity' },
      ],
    },
    ignoreSelf: {
      type: 'boolean',
      label: 'Ignore self',
      description: 'Ignore edits and deletes for messages sent by you.',
      default: false,
    },
  },

  renderer: fs.readFileSync(path.join(__dirname, 'renderer.js'), 'utf8'),
};
