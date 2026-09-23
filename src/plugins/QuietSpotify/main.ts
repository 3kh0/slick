// The embed is a cross-origin iframe, so the page can't touch its audio.
// Patching Audio.prototype.play inside the frame catches every element Spotify
// creates; setting .volume at dom-ready races the player and usually loses.

import type { SlickMainPlugin } from '$slick';

const EMBED_PREFIX = 'https://open.spotify.com/embed/';
const DEFAULT_VOLUME = 10;

function volumeFraction(value: unknown): number {
  const percent = Number(value);
  if (!Number.isFinite(percent)) return DEFAULT_VOLUME / 100;
  return Math.min(Math.max(percent, 0), 100) / 100;
}

// Re-entrant: an already-patched frame takes the new volume instead of
// stacking a second wrapper on play.
const frameScript = (volume: number) => `(function (volume) {
  if (window.__slickQuietSpotify) {
    window.__slickQuietSpotify.volume = volume;
    return;
  }
  const play = Audio.prototype.play;
  const state = (window.__slickQuietSpotify = { volume, play });
  state.wrapper = function () {
    this.volume = state.volume;
    return play.apply(this, arguments);
  };
  Audio.prototype.play = state.wrapper;
})(${volume});`;

const restoreScript = `(function () {
  const state = window.__slickQuietSpotify;
  if (!state) return;
  if (Audio.prototype.play === state.wrapper) Audio.prototype.play = state.play;
  delete window.__slickQuietSpotify;
})();`;

const plugin: SlickMainPlugin = {
  id: 'QuietSpotify',
  capabilities: ['frames'],

  ready(ctx) {
    let volume = volumeFraction(ctx.settings.volume);
    const frames = new Set<Electron.WebFrameMain>();

    const apply = (frame: Electron.WebFrameMain) => {
      frame
        .executeJavaScript(frameScript(volume))
        .catch((error: Error) => ctx.log('could not set the embed volume:', error.message));
    };

    const disposeSettings = ctx.onSettingsChange((settings) => {
      volume = volumeFraction(settings.volume);
      // Already-open embeds pick the new volume up on their next play.
      for (const frame of frames) {
        try {
          if (frame.url.startsWith(EMBED_PREFIX)) apply(frame);
        } catch {
          // Frame destroyed.
          frames.delete(frame);
        }
      }
    });

    const disposeFrames = ctx.frames.onFrame((frame) => {
      if (!frame.url.startsWith(EMBED_PREFIX)) return;
      frames.add(frame);
      apply(frame);
    });

    return () => {
      disposeSettings();
      disposeFrames();
      for (const frame of frames) {
        try {
          if (frame.url.startsWith(EMBED_PREFIX)) void frame.executeJavaScript(restoreScript).catch(() => {});
        } catch {}
      }
      frames.clear();
    };
  },
};

export default plugin;
