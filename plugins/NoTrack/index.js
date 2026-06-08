'use strict';

module.exports = {
  meta: {
    name: 'NoTrack',
    description: "Disable Slack's built in tracking",
  },

  main(ctx) {
    // patterns obtained from uAssets and the adguard filters. thanks!
    const patterns = [
      '*://slackb.com/*',
      '*://*.slackb.com/*',
      '*://slack.com/beacon/*',
      '*://*.slack.com/beacon/*',
      '*://slack.com/clog/*',
      '*://*.slack.com/clog/*',
      '*://*.slack-edge.com/*/slack_beacon.*',
    ];
    ctx.blockURLs(patterns);
    ctx.log(`[notrack] blocking ${patterns.length} patterns`);
  },
};
