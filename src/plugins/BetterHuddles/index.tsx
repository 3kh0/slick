import { SlickPlugin } from '$slick';
import { createHuddleCall, type HuddleCall } from './huddleCall.ts';
import { resumeHuddleAfterReload, saveHuddleForReload } from './huddleResume.ts';
import { createMediaSession } from './media/mediaSession.ts';
import * as meta from './meta.ts';
import { loadPreferences, savePreferences } from './preferences.ts';
import { readPreviewSelection, type PreviewSelection } from './preview.ts';
import { callWithFallback, candidateTeams, readLocalConfigTeams, routeTeamId } from './slackApi.ts';
import { closePreparedWindows, TAKEN_OVER_THUNKS, takeOverRequest } from './takeOver.ts';
import { CallApp } from './ui/CallWindow.tsx';
import { conversationLabel, memberDisplayName } from './ui/callText.ts';
import { huddleUiContext, type HuddleUiServices } from './ui/context.ts';
import { CALL_WINDOW_CSS } from './ui/styles.ts';
import { createCallPresentation, prepareCallDocument } from './ui/presentation.ts';
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
  // Moving the call UI must not restart its media session.
  static readonly liveSettings = ['layout', 'compactNoVideo'];

  private call: HuddleCall | null = null;
  private root: ReactRoot | null = null;
  private host: HTMLElement | null = null;
  private presentation: ReturnType<typeof createCallPresentation> | null = null;
  private unsubscribeCall: (() => void) | null = null;
  private preview: PreviewSelection | null = null;
  private previewWindow: Window | null = null;
  // Mirrors the setting so the open call window re-lays out when it changes.
  private readonly compactNoVideo = createValueStore(true);
  private readonly inlineLayout = createValueStore<'page' | 'window' | 'minimized'>('page');

  start() {
    this.api.setStyle(CALL_WINDOW_CSS);
    this.compactNoVideo.set(this.config.compactNoVideo !== false);
    this.inlineLayout.set(this.config.layout === 'separate' ? 'page' : this.config.layout);
    const teams = () => candidateTeams(readLocalConfigTeams(), routeTeamId(location.pathname));
    const call = createHuddleCall({
      teams,
      createMedia: createMediaSession,
      preferences: loadPreferences(localStorage),
      savePreferences: (preferences) => savePreferences(localStorage, preferences),
    });
    this.call = call;
    const documents = new Set<Document>([document]);
    this.api.onDocument((doc) => {
      documents.add(doc);
      doc.defaultView?.addEventListener('pagehide', () => documents.delete(doc), { once: true });
    });
    this.api.patchComponent<{ channelId: string; onHuddleJoin: () => void }>(
      'HuddleInviteWindowWithPreviewContent',
      (Original) => (props) => (
        <Original
          {...props}
          onHuddleJoin={() => {
            const doc = [...documents].find(
              (candidate) =>
                !candidate.defaultView?.closed && candidate.defaultView?.name.includes(`huddle_${props.channelId}`),
            );
            const getDevices = this.api.getExport<() => unknown>(
              (value: any) => typeof value === 'function' && value.name === 'getPrioritizedDeviceLists',
            );
            this.preview = readPreviewSelection(props.channelId, doc, getDevices?.());
            this.previewWindow = doc?.defaultView ?? null;
            props.onHuddleJoin();
          }}
        />
      ),
    );

    for (const name of TAKEN_OVER_THUNKS) {
      this.api.redux.patchThunk(name, (original) => (...args: unknown[]) => {
        const thunk = original(...args);
        const request = takeOverRequest(args[0]);
        // Until the window can render (or for huddles we can't join), Slack keeps its own huddle.
        if (!request || !this.presentation || typeof thunk !== 'function') return thunk;
        // A proxy keeps whatever metadata Slack hangs on the thunk while replacing what it does.
        return new Proxy(thunk, {
          apply: () => {
            const fromPreview = (args[0] as { fromJoinPreview?: boolean })?.fromJoinPreview === true;
            const preview = fromPreview && this.preview?.channelId === request.channelId ? this.preview : null;
            this.preview = null;
            if (preview) this.previewWindow?.close();
            this.previewWindow = null;
            if (preview)
              call.setAudioPreferences({
                audioInputId: preview.audioInputId,
                audioOutputId: preview.audioOutputId,
              });
            closePreparedWindows(args[0]);
            this.presentation?.show(this.config.layout === 'separate');
            void call.join(request.channelId, {
              muted: preview?.muted ?? request.muted,
              cameraOn: preview?.cameraOn,
              cameraInputId: preview?.cameraInputId,
            });
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
        this.unsubscribeCall?.();
        this.presentation?.dispose();
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

  onSettingsChange(changed: string[]) {
    this.compactNoVideo.set(this.config.compactNoVideo !== false);
    if (changed.includes('layout') && this.config.layout !== 'separate') this.inlineLayout.set(this.config.layout);
    if (changed.includes('layout') && this.call && this.call.state.get().status !== 'idle')
      this.presentation?.show(this.config.layout === 'separate');
  }

  async stop() {
    this.preview = null;
    this.previewWindow = null;
    this.unsubscribeCall?.();
    this.unsubscribeCall = null;
    this.presentation?.dispose();
    this.presentation = null;
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
    const call = this.call;
    this.presentation = createCallPresentation({
      document,
      open: () =>
        window.open(
          'about:blank',
          `slick-huddle-${routeTeamId(location.pathname)}`,
          'popup=yes,width=960,height=720,resizable=yes,slick-titlebar=inline',
        ),
      mount: (doc, detached) => {
        const restore = detached ? prepareCallDocument(document, doc) : () => {};
        const host = doc.createElement('div');
        host.className = 'sbh-host';
        host.dataset.macDesktop = String(this.api.loader === 'electron' && navigator.platform.startsWith('Mac'));
        doc.body.append(host);
        const root = reactDom.createRoot(host);
        const Provider = huddleUiContext().Provider;
        root.render(
          <Provider value={this.services(call, doc, detached)}>
            <CallApp />
          </Provider>,
        );
        this.host = host;
        this.root = root;
        return () => {
          restore();
          root.unmount();
          host.remove();
          this.root = null;
          this.host = null;
        };
      },
      onClose: () => void call.leave(),
      onBlocked: () =>
        console.warn('[slick] [Better Huddles] Allow pop-ups to open the huddle separately; showing it inside Slack.'),
    });
    this.presentation.show(false);
    this.api.signal.addEventListener('abort', () => this.presentation?.dispose(), { once: true });
    let previous = call.state.get().status;
    this.unsubscribeCall = call.state.subscribe(() => {
      const status = call.state.get().status;
      if (status === 'idle') this.presentation?.show(false);
      else if (previous === 'idle') this.presentation?.show(this.config.layout === 'separate');
      previous = status;
    });
  }

  private services(call: HuddleCall, doc: Document, detached: boolean): HuddleUiServices {
    const { members, channels } = this.api;
    return {
      useInlineLayout: () => React.useSyncExternalStore(this.inlineLayout.subscribe, this.inlineLayout.get),
      setInlineLayout: (layout) => {
        this.inlineLayout.set(layout);
        this.presentation?.show(false);
        void this.api.settings.set('layout', layout);
      },
      document: doc,
      detached,
      moveCall: (separate) => {
        if (!separate) this.inlineLayout.set('page');
        this.presentation?.show(separate);
        void this.api.settings.set('layout', separate ? 'separate' : 'page');
      },
      call,
      useMember: members.useMember,
      conversationLabel: (channelId) =>
        conversationLabel(channels.getCachedChannel(channelId), (userId) => {
          const member = members.getCachedMember(userId);
          return member ? memberDisplayName(member) : undefined;
        }),
      useCompactNoVideo: () => React.useSyncExternalStore(this.compactNoVideo.subscribe, this.compactNoVideo.get),
    };
  }
}
