// yoinked from IzieStratt implementation https://github.com/jeremy46231/taut/commit/358eb74805fee8136b395303d77c01491820ecc6

import { SlickPlugin } from '$slick';
import * as meta from './meta.ts';

type HuddleState = {
  peers?: { byId?: Record<string, { userId?: string }> };
  members?: Record<string, { profile?: { display_name?: string; real_name?: string }; name?: string }>;
};

export default class HuddleMuteDetector extends SlickPlugin<typeof meta.settings> {
  static readonly requiredAPIs = ['redux'] as const;
  static readonly id = meta.id;
  static readonly pluginName = meta.pluginName;
  static readonly description = meta.description;
  static readonly category = meta.category;
  static readonly defaultEnabled = meta.defaultEnabled;
  static readonly settings = meta.settings;

  start() {
    const onPeerMute = this.onPeerMute.bind(this);
    this.api.redux.patchThunk('displayAlertMessage', (original) => {
      return function (this: unknown, ...args: unknown[]) {
        const thunk = Reflect.apply(original, this, args);
        const payload = args[0] as { alert?: unknown; peerId?: unknown } | undefined;
        if (payload?.alert !== 'peerMuteRequest' || typeof payload.peerId !== 'string' || typeof thunk !== 'function') {
          return thunk;
        }
        const attendeeId = payload.peerId;
        // Huddles can use a separate store, including in portal pop-outs. The
        // thunk receives the right dispatch/getState; getRawState targets the
        // main window instead. A proxy also preserves Slack's thunk metadata.
        return new Proxy(thunk, {
          apply(target, receiver, thunkArgs) {
            void onPeerMute(attendeeId, thunkArgs[0], thunkArgs[1]);
            return Reflect.apply(target, receiver, thunkArgs);
          },
        });
      };
    });
  }

  private async onPeerMute(
    attendeeId: string,
    dispatch: (action: unknown) => unknown,
    getState: () => HuddleState | undefined,
  ): Promise<void> {
    try {
      if (this.api.signal.aborted) return;
      const state = getState();
      // The main window can receive the same alert without the peer mapping.
      const userId = state?.peers?.byId?.[attendeeId]?.userId;
      if (typeof userId !== 'string' || !userId) return;
      const member = state?.members?.[userId];
      const name = member?.profile?.display_name || member?.profile?.real_name || member?.name || userId;
      const toast = await this.api.redux.waitForThunkCreator('enqueueHuddleToast');
      if (this.api.signal.aborted) return;
      await dispatch(toast({ content: `${name} muted you.`, huddleToastType: 'peer_mute_request' }));
    } catch {
      // Missing/lazy Slack modules must never interrupt the normal mute alert.
    }
  }
}
