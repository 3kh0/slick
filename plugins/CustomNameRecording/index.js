'use strict';
const fs = require('fs');
const path = require('path');

module.exports = {
  meta: {
    name: 'CustomNameRecording',
    description: 'Upload custom audio as your Slack name recording',
    version: '1.0.0',
  },
  css: `
    .slick-cnr-record-button,
    .slick-cnr-upload-button {
      display: inline-flex !important;
      align-items: center !important;
      vertical-align: middle !important;
    }
    .slick-cnr-record-button {
      min-width: 36px !important;
      padding-inline: 8px !important;
    }
    .slick-cnr-record-button .margin_left_25 {
      display: none !important;
    }
    .slick-cnr-upload-button {
      margin-left: 8px;
    }
    .slick-cnr-upload-button[hidden] {
      display: none !important;
    }
  `,
  renderer: fs.readFileSync(path.join(__dirname, 'renderer.js'), 'utf8'),
};
