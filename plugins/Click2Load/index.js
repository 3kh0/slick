'use strict';
const fs = require('fs');
const path = require('path');

const PROVIDER_DOMAINS = ['spotify.com', 'soundcloud.com'];

const setting = (label, description) => ({
  type: 'boolean',
  label,
  description,
  default: false,
});

module.exports = {
  meta: {
    name: 'Click2Load',
    description: 'Replaces third-party media embeds with privacy-preserving click-to-load placeholders',
  },

  settings: {
    spotify: setting('Spotify', 'Allow Spotify embeds to load without asking'),
    soundcloud: setting('SoundCloud', 'Allow SoundCloud embeds to load without asking'),
    other: setting(
      'Other message embeds',
      'Allow other third-party frames embedded in Slack messages to load without asking',
    ),
  },

  renderer: fs.readFileSync(path.join(__dirname, 'renderer.js'), 'utf8'),

  main(ctx) {
    const trusted = new Map();
    const patterns = [`https://slick.click2load/*`];
    for (const domain of PROVIDER_DOMAINS) patterns.push(`*://${domain}/*`, `*://*.${domain}/*`);

    const frameKey = (details) => `${details.webContentsId}:${details.frame?.routingId ?? details.frameId}`;
    const isProvider = (host) => PROVIDER_DOMAINS.some((domain) => host === domain || host.endsWith(`.${domain}`));

    ctx.interceptRequests(patterns, (details) => {
      let url;
      try {
        url = new URL(details.url);
      } catch {
        return { cancel: true };
      }

      if (url.hostname === 'slick.click2load') {
        if (details.resourceType !== 'subFrame') return { cancel: true };
        let target;
        try {
          target = new URL(url.searchParams.get('url'));
        } catch {
          return { cancel: true };
        }
        if (target.protocol !== 'https:' && target.protocol !== 'http:') return { cancel: true };
        trusted.set(frameKey(details), Date.now() + 15000);
        return { redirectURL: target.href };
      }

      if (!isProvider(url.hostname)) return null;
      if (details.resourceType !== 'subFrame') return {};

      const key = frameKey(details);
      const expires = trusted.get(key) || 0;
      if (expires > Date.now()) return {};
      trusted.delete(key);
      return { cancel: true };
    });
  },
};
