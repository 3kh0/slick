'use strict';

const cssString = (value) => JSON.stringify(String(value));

module.exports = {
  meta: {
    name: 'CustomSlackbot',
    description: 'Customize the name and avatar used for workspace custom responses',
  },

  settings: {
    name: {
      type: 'text',
      label: 'Display name',
      description: "Name shown on custom responses. Leave blank to use Slack's default.",
      default: 'Slackbot',
    },
    url: {
      type: 'text',
      label: 'Avatar URL',
      description: "Image shown on custom responses. Leave blank to use Slack's default.",
      default: 'https://ca.slack-edge.com/E09V59WQY1E-USLACKBOT-sv41d8cd98f0-192',
    },
    badge: {
      type: 'boolean',
      label: 'Hide custom response badge',
      description: 'Hide the badge that identifies messages as custom responses',
      default: true,
    },
  },

  css(settings) {
    const n = String(settings.name || '').trim();
    const a = String(settings.url || '').trim();
    return [
      a &&
        `.c-message_kit__background--labels--custom_response .c-message_kit__avatar { background-image: url(${cssString(a)}) !important; }`,
      n && `.c-message_kit__background--labels--custom_response .c-message__sender_button { font-size: 0 !important; }`,
      n &&
        `.c-message_kit__background--labels--custom_response .c-message__sender_button::after { content: ${cssString(n)}; font-size: 15px; }`,
      settings.badge &&
        `.c-message_kit__background--labels--custom_response [data-qa="custom_response_info_badge"] { display: none !important; }`,
    ]
      .filter(Boolean)
      .join('\n');
  },
};
