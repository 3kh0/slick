// HcaStatus, main-process half.
//
// One job: call the verification endpoint, which the Slack page cannot reach
// cross-origin. The renderer's cache means this is asked once per user per
// day, so there is no cache here -- two would only disagree.

import type { SlickMainPlugin } from '$slick';

const ENDPOINT = 'https://auth.hackclub.com/api/external/check';
const USER_ID = /^[UW][A-Z0-9]+$/;

/** Anything that is not one of the two known verified states is unverified. */
function toStatus(result: unknown): 'eligible' | 'over_18' | 'unverified' {
  if (result === 'verified_eligible') return 'eligible';
  if (result === 'verified_but_over_18') return 'over_18';
  return 'unverified';
}

const plugin: SlickMainPlugin = {
  id: 'HcaStatus',
  capabilities: ['net'],

  rpc: {
    async check(ctx, args) {
      const [userId] = args;
      if (typeof userId !== 'string' || !USER_ID.test(userId)) throw new Error('bad user id');

      const response = await ctx.net.fetch(`${ENDPOINT}?slack_id=${encodeURIComponent(userId)}`);
      if (response.status < 200 || response.status >= 300) throw new Error(`HTTP ${response.status}`);

      return toStatus(JSON.parse(response.body)?.result);
    },
  },
};

export default plugin;
