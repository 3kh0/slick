// QuietSpotify, main-process half.
//
// The embed is a cross-origin iframe from open.spotify.com, so nothing in the
// Slack page can touch its audio. The volume is applied by patching
// `Audio.prototype.play` inside the frame, which catches the element Spotify
// creates however and whenever it creates it -- setting `.volume` on whatever
// exists at dom-ready races with the player and usually loses.
//
// v1 re-injected the whole script on every frame load and read the volume off
// disk each time, because the main half had no settings channel. It does now.

import type { SlickMainPlugin } from '$slick';

const EMBED_PREFIX = 'https://open.spotify.com/embed/';
const DEFAULT_VOLUME = 10;

/** 0-100 from settings, as the 0-1 fraction the media element wants. */
function volumeFraction(value: unknown): number {
  const percent = Number(value);
  if (!Number.isFinite(percent)) return DEFAULT_VOLUME / 100;
  return Math.min(Math.max(percent, 0), 100) / 100;
}

/**
 * Re-entrant on purpose: a frame that already has the patch takes the new
 * volume instead of stacking a second wrapper on `play`.
 */
const frameScript = (volume: number) => `(function (volume) {
  if (window.__slickQuietSpotify) {
    window.__slickQuietSpotify.volume = volume;
    return;
  }
  const state = (window.__slickQuietSpotify = { volume });
  const play = Audio.prototype.play;
  Audio.prototype.play = function () {
    this.volume = state.volume;
    return play.apply(this, arguments);
  };
})(${volume});`;

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

    ctx.onSettingsChange((settings) => {
      volume = volumeFraction(settings.volume);
      // Already-open embeds pick the new volume up on their next play.
      for (const frame of frames) {
        try {
          if (frame.url.startsWith(EMBED_PREFIX)) apply(frame);
        } catch {
          // The frame went away between the check and the call.
          frames.delete(frame);
        }
      }
    });

    ctx.frames.onFrame((frame) => {
      if (!frame.url.startsWith(EMBED_PREFIX)) return;
      frames.add(frame);
      apply(frame);
    });
  },
};

export default plugin;
