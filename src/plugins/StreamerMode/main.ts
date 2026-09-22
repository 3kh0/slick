// Silence native notifications while redaction is on in any window (state is
// per WebContents; each Slack window has its own StreamerMode instance).

import type { SlickMainPlugin } from '$slick';

const active = new Set<number>();

const plugin: SlickMainPlugin = {
  id: 'StreamerMode',
  capabilities: ['notifications'],

  ready(ctx) {
    const dispose = ctx.notifications.filter(() => active.size === 0);
    return () => {
      dispose();
      active.clear();
    };
  },

  rpc: {
    setActive(_ctx, args, sender) {
      const [on] = args;
      if (typeof on !== 'boolean') throw new Error('bad argument');

      if (on) {
        active.add(sender.id);
        // A closed window must not mute the app forever.
        sender.once('destroyed', () => active.delete(sender.id));
      } else {
        active.delete(sender.id);
      }
      return active.size > 0;
    },
  },
};

export default plugin;
