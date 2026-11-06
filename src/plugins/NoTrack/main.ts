// Block Slack's telemetry endpoints.

import type { SlickMainPlugin } from '$slick';
import { TELEMETRY } from './telemetry.ts';

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
