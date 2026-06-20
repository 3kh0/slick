'use strict';

const fs = require('fs');
const path = require('path');

const CSS = `
.p-message_input__input_container_unstyled:not(.slick-smb-stacked) .c-basic_container__body{display:flex!important;flex-direction:row!important;flex-wrap:wrap;align-items:center!important;column-gap:6px;}
.p-message_input__input_container_unstyled:not(.slick-smb-stacked) .c-wysiwyg_container__footer{display:contents!important;}
.p-message_input__input_container_unstyled:not(.slick-smb-stacked) .c-basic_container__body>:first-child{order:1;flex:1 0 100%;}
.p-message_input__input_container_unstyled:not(.slick-smb-stacked) .c-basic_container__body>:first-child:empty{display:none;}
.p-message_input__input_container_unstyled:not(.slick-smb-stacked) .c-wysiwyg_container__prefix{order:2;}
.p-message_input__input_container_unstyled:not(.slick-smb-stacked) .c-texty_input_unstyled__container{order:3;flex:1 1 0%!important;min-width:140px;}
.p-message_input__input_container_unstyled:not(.slick-smb-stacked) .c-wysiwyg_container__toolbar_buttons{order:4;flex:0 0 auto!important;}
.p-message_input__input_container_unstyled:not(.slick-smb-stacked) .c-wysiwyg_container__suffix{order:5;}
`;

module.exports = {
  meta: {
    name: 'SlimMessageBox',
    description: 'ozempic for your message box!',
  },
  capabilities: ['internals'],
  settings: {
    discordLayout: {
      type: 'boolean',
      label: 'Discord-style one-line layout',
      description: 'File button left, message box middle, other buttons right. Reverts to stacked when multi-line.',
      default: true,
    },
    hideFormatting: {
      type: 'boolean',
      label: 'Hide formatting (Aa)',
      description: 'Remove the rich-text formatting toggle.',
      default: false,
    },
    hideEmoji: {
      type: 'boolean',
      label: 'Hide emoji',
      description: 'Remove the emoji picker button.',
      default: false,
    },
    hideMention: {
      type: 'boolean',
      label: 'Hide mention (@)',
      description: 'Remove the mention-someone button.',
      default: false,
    },
    hideVideo: {
      type: 'boolean',
      label: 'Hide video clip',
      description: 'Remove the record-video-clip button.',
      default: false,
    },
    hideAudio: {
      type: 'boolean',
      label: 'Hide audio clip',
      description: 'Remove the record-audio-clip button.',
      default: false,
    },
    hideSlash: {
      type: 'boolean',
      label: 'Hide shortcuts (/)',
      description: 'Remove the run-shortcut / slash-commands button.',
      default: false,
    },
    hideBroadcast: {
      type: 'boolean',
      label: "Hide 'Also send to #channel'",
      description: 'Remove the broadcast-to-channel checkbox shown in thread replies.',
      default: false,
    },
  },
  css: (settings) => (settings.discordLayout ? CSS : ''),
  renderer: fs.readFileSync(path.join(__dirname, 'renderer.js'), 'utf8'),
};
