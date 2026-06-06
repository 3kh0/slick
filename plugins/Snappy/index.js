'use strict';

const fs = require('fs');
const path = require('path');

module.exports = {
  meta: {
    name: 'Snappy',
    description: 'Make Slack feel more responsive by disabling animations and other slow features',
    version: '1.0.0',
  },

  settings: {
    ignoreGpuBlocklist: {
      type: 'boolean',
      label: 'Ignore GPU blocklist',
      description: 'Force hardware acceleration features that Chromium disabled for this GPU',
      default: false,
      restartRequired: true,
    },
    disableCrashReporter: {
      type: 'boolean',
      label: 'Disable crash reporter',
      description: 'Prevent Slack from starting Crashpad and adding crash metadata',
      default: true,
      restartRequired: true,
    },
    disableSpellcheck: {
      type: 'boolean',
      label: 'Disable composer spellcheck',
      description: 'Disable native spellchecking in Slack message composers',
      default: false,
    },
  },

  css: `
    .p-client_container,
    .p-client_container * {
      transition-duration: .01ms !important;
      transition-delay: 0s !important;
    }
  `,

  renderer: fs.readFileSync(path.join(__dirname, 'renderer.js'), 'utf8'),
};
