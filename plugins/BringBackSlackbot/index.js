'use strict';

// CSS by @jeremy46231.
module.exports = {
  meta: {
    name: 'BringBackSlackbot',
    description: 'Bring back Slackbot on workspace custom responses',
  },

  css: `
    .c-message_kit__background--labels--custom_response {
      .c-message_kit__avatar {
        background-image: url("https://ca.slack-edge.com/E09V59WQY1E-USLACKBOT-sv41d8cd98f0-48") !important;
      }
      .c-message__sender_button {
        font-size: 0px;
        &::after {
          content: "Slackbot";
          font-size: 15px;
        }
      }
      [data-qa="custom_response_info_badge"] {
        display: none !important;
      }
    }
  `,
};
