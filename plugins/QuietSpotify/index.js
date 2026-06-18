'use strict';
const fs = require('fs');
const path = require('path');

const frameJs = (volume) => `(function (volume) {
  if (window.__slickQuietSpotify) {
    window.__slickQuietSpotify.volume = volume;
    return;
  }
  const state = (window.__slickQuietSpotify = { volume });
  const og = Audio.prototype.play;
  Audio.prototype.play = function () {
    this.volume = state.volume;
    return og.apply(this, arguments);
  };
})(${volume});`;

module.exports = {
  meta: {
    name: 'QuietSpotify',
    description: 'Customize the volume of Spotify embeds so they are not stupidly loud',
  },

  settings: {
    volume: {
      type: 'number',
      label: 'Volume (%)',
      description: '0-100. Anything above 10% is very loud.',
      default: 10,
    },
  },

  main(ctx) {
    const settingsFile = path.join(ctx.app.getPath('userData'), 'slick', 'plugin-settings.json');

    const volume = () => {
      let v = ctx.settings.volume;
      try {
        const stored = JSON.parse(fs.readFileSync(settingsFile, 'utf8'))[ctx.name];
        if (stored && stored.volume !== undefined) v = Number(stored.volume);
      } catch (e) {}
      if (!Number.isFinite(v)) v = 10;
      return Math.min(Math.max(v, 0), 100) / 100;
    };

    ctx.onWindow((win) => {
      win.webContents.on('frame-created', (_event, { frame }) => {
        if (!frame) return;
        frame.on('dom-ready', () => {
          if (!frame.url.startsWith('https://open.spotify.com/embed/')) return;
          frame.executeJavaScript(frameJs(volume())).catch((e) => ctx.log('inject failed:', e.message));
        });
      });
    });
  },
};
