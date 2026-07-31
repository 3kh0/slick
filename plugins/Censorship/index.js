'use strict';

const fs = require('fs');
const path = require('path');

module.exports = {
  meta: {
    name: 'Censorship',
    description: 'There is no war in Ba Sing Se.',
  },

  settings: {
    terms: {
      type: 'text',
      label: 'Blocked terms',
      description: 'Comma-separated terms to censor',
      default: 'job, employment',
    },
    style: {
      type: 'select',
      label: 'Blocking style',
      description: 'How matched terms should be replaced',
      default: 'stars',
      options: [
        { value: 'stars', label: 'Stars' },
        { value: 'hashtags', label: 'Hashtags' },
        { value: 'blocks', label: 'Unicode blocks' },
        { value: 'custom', label: 'Custom replacement' },
      ],
    },
    replacement: {
      type: 'text',
      label: 'Custom replacement',
      description: 'Select custom replacement style to use this',
      default: 'uwu',
    },
    keepFirstLetter: {
      type: 'boolean',
      label: 'Keep first letter',
      description: 'Show the first letter of a censored word instead of masking it',
      default: false,
    },
    keepLastLetter: {
      type: 'boolean',
      label: 'Keep last letter',
      description: 'Show the last letter of a censored word instead of masking it',
      default: false,
    },
  },

  renderer: fs.readFileSync(path.join(__dirname, 'renderer.js'), 'utf8'),
};
