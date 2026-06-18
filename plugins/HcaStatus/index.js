'use strict';
const fs = require('fs');
const path = require('path');

const HCA_API = 'https://auth.hackclub.com/api/external/check';
const POLL_MS = 800;
const TTL = 24 * 60 * 60 * 1000;

const cache = new Map();
const inflight = new Map();

function mapResult(result) {
  if (result === 'verified_eligible') return 'eligible';
  if (result === 'verified_but_over_18') return 'over_18';
  return 'unverified'; // literally anything else
}

function fetchStatus(net, id) {
  const hit = cache.get(id);
  if (hit && Date.now() - hit.at < TTL) return Promise.resolve(hit.status);
  if (inflight.has(id)) return inflight.get(id);

  const doFetch = net && net.fetch ? net.fetch.bind(net) : fetch;
  const p = (async () => {
    try {
      const res = await doFetch(`${HCA_API}?slack_id=${encodeURIComponent(id)}`);
      if (!res.ok) throw new Error('HTTP ' + res.status);
      const data = await res.json();
      const status = mapResult(data.result);
      cache.set(id, { status, at: Date.now() });
      return status;
    } catch {
      return null;
    } finally {
      inflight.delete(id);
    }
  })();
  inflight.set(id, p);
  return p;
}

module.exports = {
  meta: {
    name: 'HcaStatus',
    description: 'Flag users who have not completed identity verification',
  },
  settings: {
    unverifiedColor: {
      type: 'color',
      label: 'Unverified color',
      description: 'Underline color for users who have not verified',
      default: '#e01e5a',
    },
    over18Color: {
      type: 'color',
      label: 'Over-18 color',
      description: 'Underline color for users verified as over 18',
      default: '#d97706',
    },
  },
  renderer: fs.readFileSync(path.join(__dirname, 'renderer.js'), 'utf8'),

  css: (s) => `
    .slick-hca-unverified,
    .slick-hca-unverified .c-message__sender_button {
      text-decoration: underline wavy ${s.unverifiedColor} !important;
      text-decoration-thickness: 1px !important;
    }
    .slick-hca-over-18,
    .slick-hca-over-18 .c-message__sender_button {
      text-decoration: underline wavy ${s.over18Color} !important;
      text-decoration-thickness: 1px !important;
    }
  `,

  main(ctx) {
    const net = ctx.electron && ctx.electron.net;

    ctx.onWindow((win) => {
      const wc = win.webContents;
      let timer = null;

      const stop = () => {
        if (timer) clearInterval(timer);
        timer = null;
      };

      const tick = async () => {
        if (wc.isDestroyed()) return stop();
        let ids;
        try {
          ids = await wc.executeJavaScript(
            'window.__slickhca && window.__slickhca.drain ? window.__slickhca.drain() : []',
            true,
          );
        } catch {
          return;
        }
        if (!Array.isArray(ids) || !ids.length) return;

        const results = {};
        await Promise.all(
          ids.map(async (id) => {
            results[id] = await fetchStatus(net, id);
          }),
        );
        if (wc.isDestroyed()) return;
        wc.executeJavaScript(`window.__slickhca && window.__slickhca.apply(${JSON.stringify(results)})`, true).catch(
          () => {},
        );
      };

      timer = setInterval(() => {
        tick().catch(() => {});
      }, POLL_MS);
      wc.on('destroyed', stop);
    });
  },
};
