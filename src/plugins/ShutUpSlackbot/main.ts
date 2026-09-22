// ShutUpSlackbot, main-process half.
//
// v1 replaced `electron.Notification` with its own constructor and wrapped
// `Notification.prototype.show`. StreamerMode did the same thing
// independently, so whichever installed second silently defeated the other --
// the single clearest argument for the shared filter this now registers on.

import type { SlickMainPlugin } from '$slick';
import { isSlashCommandNotice, notificationText } from './detect.ts';

const plugin: SlickMainPlugin = {
  id: 'ShutUpSlackbot',
  capabilities: ['notifications'],

  ready(ctx) {
    // Returning false vetoes the notification.
    return ctx.notifications.filter((options) => !isSlashCommandNotice(notificationText(options)));
  },
};

export default plugin;
