'use strict';
const fs = require('fs');
const path = require('path');

module.exports = {
  meta: {
    name: 'CopyReacted',
    description: 'Copy the list of users who reacted to a message',
  },
  settings: {
    format: {
      type: 'select',
      label: 'Copy format',
      description: 'How each reactor is represented',
      default: 'mentions',
      options: [
        { value: 'names', label: 'Display names' },
        { value: 'handles', label: 'Usernames (@handle)' },
        { value: 'mentions', label: 'Mentions (<@USER_ID>)' },
      ],
    },
    separator: {
      type: 'select',
      label: 'Separator',
      description: 'How the names are joined',
      default: 'newline',
      options: [
        { value: 'newline', label: 'One per line' },
        { value: 'comma', label: 'Comma separated' },
      ],
    },
  },

  css: function () {
    return `
    .slick-cr__btn {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      height: 24px;
      margin: 0 4px 4px 0;
      padding: 0 8px;
      vertical-align: top;
      border: none;
      border-radius: 9999px;
      background-color: var(--dt_color-surf-pry);
      color: var(--dt_color-content-ter);
      cursor: pointer;
      transition: background-color 80ms ease, box-shadow 80ms ease, transform 80ms ease, color 80ms ease;
    }
    .slick-cr__btn:hover {
      background-color: rgba(0, 0, 0, 0);
      box-shadow: 0 0 0 1px var(--dt_color-otl-pry);
      color: var(--dt_color-content-pry);
    }
    .slick-cr__btn:active {
      transform: scale(0.94);
    }
    .slick-cr__menu {
      position: fixed;
      z-index: 9999;
      min-width: 180px;
      max-width: 320px;
      max-height: 60vh;
      overflow-y: auto;
      padding: 6px;
      border-radius: 8px;
      background-color: var(--dt_color-ctr-pry);
      box-shadow: 0 0 0 1px rgba(var(--sk_foreground_low, 29, 28, 29), 0.13), 0 4px 12px 0 #0000001f;
    }
    .slick-cr__row {
      display: flex;
      align-items: center;
      gap: 8px;
      width: 100%;
      text-align: left;
      padding: 6px 10px;
      border: none;
      border-radius: 6px;
      background: transparent;
      color: var(--dt_color-content-pry);
      font-size: 13px;
      line-height: 1.3;
      cursor: pointer;
    }
    .slick-cr__row:hover {
      background-color: var(--dt_color-highlight);
    }
    .slick-cr__emoji {
      flex: 0 0 auto;
      width: 16px !important;
      height: 16px !important;
      object-fit: contain;
      vertical-align: middle;
    }
    .slick-cr__label {
      flex: 1 1 auto;
      overflow: hidden;
      white-space: nowrap;
      text-overflow: ellipsis;
    }
    .slick-cr__sep {
      height: 1px;
      margin: 5px 4px;
      background-color: var(--dt_color-otl-ter);
    }
    .slick-cr__toast {
      position: fixed;
      bottom: 24px;
      left: 50%;
      transform: translateX(-50%) translateY(8px);
      z-index: 10000;
      padding: 8px 14px;
      border-radius: 8px;
      background-color: var(--dt_color-ctr-pry);
      color: var(--dt_color-content-pry);
      font-size: 13px;
      box-shadow: 0 0 0 1px rgba(var(--sk_foreground_low, 29, 28, 29), 0.13), 0 4px 12px 0 #0000001f;
      opacity: 0;
      pointer-events: none;
      transition: opacity 120ms ease, transform 120ms ease;
    }
    .slick-cr__toast--on {
      opacity: 1;
      transform: translateX(-50%) translateY(0);
    }
  `;
  },
  renderer: fs.readFileSync(path.join(__dirname, 'renderer.js'), 'utf8'),
};
