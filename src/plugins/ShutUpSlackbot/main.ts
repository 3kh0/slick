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
