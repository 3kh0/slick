// Stop Slack telling everyone you are typing, by stubbing the typing thunks
// rather than filtering WebSocket frames.

import { SlickPlugin } from '$slick';
import * as meta from './meta.ts';

export default class SilentTyping extends SlickPlugin<typeof meta.settings> {
  static readonly id = meta.id;
  static readonly pluginName = meta.pluginName;
  static readonly description = meta.description;
  static readonly defaultEnabled = meta.defaultEnabled;
  static readonly settings = meta.settings;

  static readonly liveSettings = ['inThreads'];

  start() {
    // Slack routes every typing notification through these two thunks.
    for (const name of ['currentUserStartedTyping', 'currentUserEndedTyping']) {
      this.api.redux.patchThunk(name, (original) => (...args: unknown[]) => {
        if (!this.config.inThreads && this.isThread(args)) return original(...args);
        // A no-op thunk still has to be dispatchable.
        return () => undefined;
      });
    }
    this.log('typing indicators suppressed');
  }

  private isThread(args: unknown[]): boolean {
    const first = args[0] as { threadTs?: string; thread_ts?: string } | undefined;
    return !!(first?.threadTs || first?.thread_ts);
  }
}
