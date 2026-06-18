'use strict';
const fs = require('fs');
const path = require('path');

module.exports = {
  meta: {
    name: 'UserPronouns',
    description: "Display users' pronouns next to their messages",
  },

  renderer: fs.readFileSync(path.join(__dirname, 'renderer.js'), 'utf8'),

  css: `
    .slick-pronouns {
      font-size: 12px;
      color: var(--slick-pronouns-color, var(--sk_foreground_max_solid, #ababad));
      white-space: nowrap;
      user-select: none;
    }
    .slick-pronouns::before {
      content: '\\2022';
      margin: 0 4px;
    }
  `,
};
