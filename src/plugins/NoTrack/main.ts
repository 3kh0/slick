// Block Slack's telemetry endpoints. Patterns from uAssets and the AdGuard filters.

import type { SlickMainPlugin } from '$slick';

const TELEMETRY = [
  '*://slackb.com/*',
  '*://*.slackb.com/*',
  '*://slack.com/beacon/*',
  '*://*.slack.com/beacon/*',
  '*://slack.com/clog/*',
  '*://*.slack.com/clog/*',
];

const plugin: SlickMainPlugin = {
  id: 'NoTrack',
  capabilities: ['requests'],

  ready(ctx) {
    const dispose = ctx.net.block(TELEMETRY);
    ctx.log(`blocking ${TELEMETRY.length} telemetry patterns`);
    return dispose;
  },
};

export default plugin;
