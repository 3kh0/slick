// Better Huddles: Slack's huddles, run by our own huddle client instead of
// Slack's. Slack's huddle-start thunks (`TAKEN_OVER_THUNKS`, see takeOver.ts)
// are swapped for our own join: rooms.join with your Slack token,
// then a direct AWS Chime connection (media/), shown in a window on top of the
// current Slack page (ui/). Slack's own huddle window never opens.

import { SlickPlugin } from '$slick';
import { createHuddleCall, type HuddleCall } from './huddleCall.ts';
import { resumeHuddleAfterReload, saveHuddleForReload } from './huddleResume.ts';
import { createMediaSession } from './media/mediaSession.ts';
import * as meta from './meta.ts';
import { loadPreferences, savePreferences } from './preferences.ts';
import { callWithFallback, candidateTeams, readLocalConfigTeams, routeTeamId } from './slackApi.ts';
import { closePreparedWindows, TAKEN_OVER_THUNKS, takeOverRequest } from './takeOver.ts';
import { CallApp } from './ui/CallWindow.tsx';
import { conversationLabel, memberDisplayName } from './ui/callText.ts';
import { huddleUiContext, type HuddleUiServices } from './ui/context.ts';
import { CALL_WINDOW_CSS } from './ui/styles.ts';
import { createValueStore } from './valueStore.ts';

type ReactRoot = { render: (node: React.ReactNode) => void; unmount: () => void };
type ReactDomClient = { createRoot: (container: Element) => ReactRoot };

// react-dom/client: Slack's own copy, so the window renders with the React that's already on the page.
// Slack's bundle re-exports only `createRoot`, so it's recognised by React's "not a DOM container" error (#299).
const isReactDomClient = (exp: any): exp is ReactDomClient => {
  const createRoot = exp?.createRoot;
  if (typeof createRoot !== 'function') return false;
  return typeof exp.hydrateRoot === 'function' || String(createRoot).includes('formatProdErrorMessage(299)');
};

export default class BetterHuddles extends SlickPlugin<typeof meta.settings> {
  static readonly requiredAPIs = ['redux', 'members', 'channels'] as const;
  static readonly id = meta.id;
  static readonly pluginName = meta.pluginName;
  static readonly description = meta.description;
  static readonly category = meta.category;
  static readonly defaultEnabled = meta.defaultEnabled;
  static readonly settings = meta.settings;
  // Only read when a call opens, so changing it mustn't restart the plugin (that would hang up).
  static readonly liveSettings = ['layout', 'compactNoVideo'];

  private call: HuddleCall | null = null;
  private root: ReactRoot | null = null;
  private host: HTMLElement | null = null;
  // Mirrors the setting so the open call window re-lays out when it changes.
  private readonly compactNoVideo = createValueStore(true);

  start() {
    this.api.setStyle(CALL_WINDOW_CSS);
    this.compactNoVideo.set(this.config.compactNoVideo !== false);
    const teams = () => candidateTeams(readLocalConfigTeams(), routeTeamId(location.pathname));
    const call = createHuddleCall({
      teams,
      createMedia: createMediaSession,
      preferences: loadPreferences(localStorage),
      savePreferences: (preferences) => savePreferences(localStorage, preferences),
    });
    this.call = call;

    for (const name of TAKEN_OVER_THUNKS) {
      this.api.redux.patchThunk(name, (original) => (...args: unknown[]) => {
        const thunk = original(...args);
        const request = takeOverRequest(args[0]);
        // Until the window can render (or for huddles we can't join), Slack keeps its own huddle.
        if (!request || !this.root || typeof thunk !== 'function') return thunk;
        // A proxy keeps whatever metadata Slack hangs on the thunk while replacing what it does.
        return new Proxy(thunk, {
          apply: () => {
            closePreparedWindows(args[0]);
            void call.join(request.channelId, { muted: request.muted });
            return Promise.resolve();
          },
        });
      });
    }

    // Closing or reloading the tab hangs up, so Slack doesn't keep showing you in the huddle;
    // a reload then rejoins (huddleResume.ts).
    window.addEventListener(
      'pagehide',
      () => {
        saveHuddleForReload(call.state.get(), sessionStorage);
        void call.leave({ keepalive: true });
      },
      { signal: this.api.signal },
    );
    this.mountWindow()
      .then(() => this.root && this.resumeAfterReload(call, teams))
      .catch((error) =>
        console.error(
          '[slick] [Better Huddles] the call window could not be set up; Slack keeps its own huddles:',
          error,
        ),
      );
  }

  onSettingsChange() {
    // `layout` is read through `initialLayout` when the next call opens.
    this.compactNoVideo.set(this.config.compactNoVideo !== false);
  }

  async stop() {
    const call = this.call;
    this.call = null;
    try {
      await call?.leave();
    } catch (error) {
      console.warn('[slick] [Better Huddles] leaving the huddle on stop failed:', error);
    }
    this.root?.unmount();
    this.root = null;
    this.host?.remove();
    this.host = null;
  }

  private async resumeAfterReload(call: HuddleCall, teams: () => ReturnType<typeof candidateTeams>) {
    const outcome = await resumeHuddleAfterReload({
      storage: sessionStorage,
      roomInfo: async (roomId) =>
        (await callWithFallback<{ room?: unknown }>(teams(), 'screenhero.rooms.info', { room: roomId })).result.room,
      join: call.join,
    });
    if (outcome === 'ended') console.info('[slick] [Better Huddles] the huddle ended while the page was reloading');
  }

  private async mountWindow() {
    const reactDom = await this.api.waitForExport<ReactDomClient>(isReactDomClient);
    if (!document.body)
      await new Promise((resolve) => document.addEventListener('DOMContentLoaded', resolve, { once: true }));
    if (!this.api.isActive() || !this.call) return;
    const host = document.createElement('div');
    host.className = 'sbh-host';
    host.dataset.macDesktop = String(this.api.loader === 'electron' && navigator.platform.startsWith('Mac'));
    document.body.append(host);
    const root = reactDom.createRoot(host);
    const Provider = huddleUiContext().Provider;
    root.render(
      <Provider value={this.services(this.call)}>
        <CallApp />
      </Provider>,
    );
    this.host = host;
    this.root = root;
  }

  private services(call: HuddleCall): HuddleUiServices {
    const { members, channels } = this.api;
    return {
      call,
      useMember: members.useMember,
      conversationLabel: (channelId) =>
        conversationLabel(channels.getCachedChannel(channelId), (userId) => {
          const member = members.getCachedMember(userId);
          return member ? memberDisplayName(member) : undefined;
        }),
      initialLayout: () => (this.config.layout === 'page' ? 'page' : 'window'),
      useCompactNoVideo: () => React.useSyncExternalStore(this.compactNoVideo.subscribe, this.compactNoVideo.get),
    };
  }
}
