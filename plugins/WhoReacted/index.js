'use strict';

const fs = require('fs');
const path = require('path');

module.exports = {
  meta: {
    name: 'WhoReacted',
    description: 'Show the avatars of everyone who reacted next to each reaction',
  },
  settings: {
    maxAvatars: {
      type: 'number',
      label: 'Max avatars',
      description: 'How many avatars to show at once',
      default: 8,
    },
  },

  css: function () {
    const overlap = Math.round(20 / 3);
    return `
    .slick-wr {
      display: inline-flex;
      align-items: center;
      margin-left: 5px;
      vertical-align: middle;
      pointer-events: none;
    }
    .slick-wr__av {
      width: 20px;
      height: 20px;
      border-radius: 50%;
      object-fit: cover;
      margin-left: -${overlap}px;
      border: 1.5px solid rgba(var(--sk_primary_background, 255, 255, 255), 1);
      background: rgba(var(--sk_foreground_min, 29, 28, 29), 0.25);
      display: block;
    }
    .slick-wr__av:first-child {
      margin-left: 0;
    }
    .slick-wr__more {
      margin-left: 3px;
      font-size: 11px;
      font-weight: 700;
      line-height: 1;
      color: rgba(var(--sk_foreground_high, 29, 28, 29), 0.9);
    }
  `;
  },
  renderer: fs.readFileSync(path.join(__dirname, 'renderer.js'), 'utf8'),
};
