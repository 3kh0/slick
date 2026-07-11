'use strict';

const fs = require('fs');
const path = require('path');

const ONELINE =
  '.p-message_input__input_container_unstyled:not(.slick-smb-stacked):not(:has(.c-wysiwyg_container__attachments,.p-message_input__attachments,.c-pending_files,.c-message__editor__composer_attachments))';

const LAYOUT_CSS = `
${ONELINE} .c-basic_container__body{display:flex!important;flex-direction:row!important;flex-wrap:wrap;align-items:center!important;column-gap:6px;}
${ONELINE} .c-wysiwyg_container__footer{display:contents!important;}
${ONELINE} .c-basic_container__body>:first-child{order:1;flex:1 0 100%;}
${ONELINE} .c-basic_container__body>:first-child:empty{display:none;}
${ONELINE} .c-wysiwyg_container__prefix{order:2;flex:0 0 auto!important;}
${ONELINE} .c-texty_input_unstyled__container{order:3;flex:1 1 0%!important;min-width:140px;}
${ONELINE} .c-wysiwyg_container__toolbar_buttons{order:4;flex:0 0 auto!important;display:inline-flex!important;width:max-content!important;min-width:0;max-width:100%;overflow:visible;}
${ONELINE} .c-wysiwyg_container__toolbar_buttons .c-texty_buttons{display:inline-flex!important;flex:0 0 auto!important;width:max-content!important;min-width:0;max-width:100%;}
${ONELINE} .c-wysiwyg_container__suffix{order:5;flex:0 0 auto!important;}
${ONELINE} .c-wysiwyg_container__footer_divider{display:none!important;}
`;

const HIDE_SELECTORS = {
  hideFormatting: 'button[aria-label="Show formatting"]',
  hideEmoji: 'button[aria-label="Emoji"]',
  hideMention: 'button[aria-label="Mention someone"]',
  hideVideo: 'button[aria-label="Record video clip"]',
  hideAudio: 'button[aria-label="Record audio clip"]',
  hideSlash: 'button[aria-label="Run shortcut"],.c-texty_buttons--overflow',
};

const SCOPE = '.p-message_input__input_container_unstyled';

function hideCss(settings) {
  const rules = [];
  for (const key in HIDE_SELECTORS) {
    if (settings[key]) rules.push(`${SCOPE} ${HIDE_SELECTORS[key]}{display:none!important;}`);
  }
  if (settings.hideBroadcast) {
    rules.push(
      `${SCOPE} .p-threads_footer__input_container__broadcast_controls{display:none!important;}`,
      `${SCOPE} .c-basic_container__body>.p-threads_footer__input_container__broadcast_controls{display:none!important;}`,
    );
  }
  return rules.join('');
}

function css(settings) {
  if (settings.discordLayout === false) return hideCss(settings);
  return LAYOUT_CSS + hideCss(settings);
}

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
      description: 'Cleaner and more streamlined message input.',
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
  css,
  renderer: fs.readFileSync(path.join(__dirname, 'renderer.js'), 'utf8'),
};
