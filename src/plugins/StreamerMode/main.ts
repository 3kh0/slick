// StreamerMode, main-process half.
//
// Only one job: silence native notifications while redaction is on. A toast
// with a DM preview in it defeats the entire plugin.
//
// v1 replaced `Notification.prototype.show` here, which collided with
// ShutUpSlackbot doing the same thing. The shared filter composes instead.
//
// State is per WebContents, because a second Slack window is a separate
// renderer with its own StreamerMode instance, and a notification should be
// suppressed if *any* of them is redacting.

import type { SlickMainPlugin } from '$slick';

const active = new Set<number>();

const plugin: SlickMainPlugin = {
  id: 'StreamerMode',
  capabilities: ['notifications'],

  ready(ctx) {
    ctx.notifications.filter(() => active.size === 0);
  },

  rpc: {
    setActive(_ctx, args, sender) {
      const [on] = args;
      if (typeof on !== 'boolean') throw new Error('bad argument');

      if (on) {
        active.add(sender.id);
        // A window that goes away while redacting must not mute the app
        // forever.
        sender.once('destroyed', () => active.delete(sender.id));
      } else {
        active.delete(sender.id);
      }
      return active.size > 0;
    },
  },
};

export default plugin;
