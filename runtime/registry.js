'use strict';

// The ordered set of plugins the early runtime carries. Every entry is a
// descriptor whose `setup` is serialized into the page bundle, so ordering is
// the order plugin hooks install in. Adding a plugin here is what makes it
// available to the browser extension, the desktop preload, and the tests.
//
// Network rewrites that share an endpoint are ordered on purpose: ClearURLs
// runs before NotShitMarkdown so tracking parameters are stripped from the
// still-plain message text.
module.exports = [
  require('./plugins/no-track'),
  require('./plugins/silent-typing'),
  require('./plugins/clear-urls'),
  require('./plugins/not-shit-markdown'),
  require('./plugins/anonymise-file-names'),
  require('./plugins/nicknames'),
  require('./plugins/slim-message-box'),
  require('./plugins/snappy'),
  require('./plugins/custom-fonts'),
  require('./plugins/censorship'),
  require('./plugins/custom-slackbot'),
  require('./plugins/click2-load'),
  require('./plugins/last-seen'),
  require('./plugins/user-pronouns'),
  require('./plugins/who-reacted'),
  require('./plugins/copy-reacted'),
  require('./plugins/show-real-user'),
  require('./plugins/private-channel-mapper'),
  require('./plugins/custom-name-recording'),
  require('./plugins/hca-status'),
  require('./plugins/admin-backend'),
  require('./plugins/shut-up-slackbot'),
  require('./plugins/custom-sounds'),
  require('./plugins/streamer-mode'),
  require('./plugins/better-captions'),
  require('./plugins/message-logger'),
  require('./plugins/b-channel'),
  require('./plugins/oneko'),
];
