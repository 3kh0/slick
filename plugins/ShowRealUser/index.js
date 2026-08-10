'use strict';

const fs = require('fs');
const path = require('path');

module.exports = {
  meta: {
    name: 'ShowRealUser',
    description: 'Show who actually sent a message when a relay bot posts on their behalf',
  },
  capabilities: ['internals'],

  renderer: fs.readFileSync(path.join(__dirname, 'renderer.js'), 'utf8'),
};
