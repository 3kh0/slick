import { SlickPlugin, type MenuTemplateItem } from '$slick';
import { getActiveTeam, readLocalConfig } from '../../app/slack/localConfig.ts';
import {
  closeTabs,
  type CloseTabsAction,
  adjacentTab,
  currentTab,
  dragScrollSpeed,
  moveTab,
  restoreTabs,
  tabKey,
  tabUri,
  splitProps,
  threadTabForMessage,
  visitTab,
  type ChatTab,
} from './tabs.ts';
import * as meta from './meta.ts';
import { addTabMenuItem, addThreadTabAction, THREAD_TAB_ACTION, type MessageAction } from './menu.ts';
import { chatLabel, chatMemberIds, chatType, memberName } from './people.ts';
import { recentPlaces, searchPlaces, type PickerPlace } from './picker.ts';
import { tabSwitchDirection } from './shortcut.ts';

type DisplayName = (state: any, channel: any, options: Record<string, boolean>) => string;

export default class ChatTabs extends SlickPlugin<typeof meta.settings> {
  static readonly id = meta.id;
  static readonly pluginName = meta.pluginName;
  static readonly description = meta.description;
  static readonly category = meta.category;
  static readonly defaultEnabled = meta.defaultEnabled;
  static readonly settings = meta.settings;
  static readonly liveSettings = [
    'threadView',
    'autoThreadTabs',
    'showSingleTab',
    'showInActivity',
    'wrapTabSwitching',
    'closeTabSelection',
    'middleClickCloses',
    'dragToSplit',
  ] as const;
  static readonly requiredAPIs = ['redux', 'elements'] as const;

  private MenuTarget = React.createContext<string | null>(null);
  private draggedTab = new this.api.Store<ChatTab | null>(null);
  private splitError = new this.api.Store('');
  private splitNavigation = Promise.resolve();
  private splitVersion = 0;
  private pickerTrigger = new this.api.Store<((anchor: HTMLButtonElement) => void) | null>(null);
  private pickerOpen = new this.api.Store(false);
  private closeCurrent?: () => void;
  private openChat?: (tab: ChatTab) => Promise<boolean | undefined>;
  private displayName?: DisplayName;
  private active = new this.api.Store(false);
  private settingsVersion = new this.api.Store(0);
  private writes = Promise.resolve();

  start() {
    this.active.set(true);
    if (this.api.loader === 'electron') this.api.main.on('close-tab', () => this.closeCurrent?.());
    void this.api
      .waitForExport(
        (value: unknown): value is DisplayName =>
          typeof value === 'function' &&
          value.length >= 2 &&
          String(value).includes('publicChannelIncludeHashSign') &&
          String(value).includes('forceMpimNames'),
      )
      .then((formatter) => {
        if (this.api.signal.aborted) return;
        this.displayName = formatter;
        this.api.redux.refresh();
      })
      .catch(() => {});
    for (const name of ['ChannelContextMenu', 'ConnectedChannel']) {
      this.api.patchComponent<{ id?: string }>(name, (Original) => (props) => (
        <this.MenuTarget.Provider value={props.id ?? null}>
          <Original {...props} />
        </this.MenuTarget.Provider>
      ));
    }
    this.api.patchComponent<{
      getTemplate?: () => MenuTemplateItem[];
      renderMenu?: (...args: any[]) => React.ReactNode;
    }>('ContextMenuTriggerWithKeyboardFocus', (Original) => (props) => {
      const channel = React.useContext(this.MenuTarget);
      if (!channel || !/^[CDG][A-Z0-9]+$/.test(channel)) return <Original {...props} />;
      const open = () => {
        void this.openChat?.({ channel });
      };
      const { getTemplate, renderMenu } = props;
      return (
        <Original
          {...props}
          getTemplate={getTemplate ? () => addTabMenuItem(getTemplate(), open) : undefined}
          renderMenu={
            renderMenu
              ? (...args) => {
                  const menu = renderMenu(...args);
                  return React.isValidElement<{ template?: MenuTemplateItem[] }>(menu) &&
                    Array.isArray(menu.props.template)
                    ? React.cloneElement(menu, { template: addTabMenuItem(menu.props.template, open) })
                    : menu;
                }
              : undefined
          }
        />
      );
    });
    this.api.patchComponent<{
      channelId?: string;
      ts?: string;
      threadTs?: string;
      actions?: MessageAction[][];
      autoClogProps?: { uiComponentName?: string };
      onSelectAction?: (...args: any[]) => unknown;
    }>(
      {
        filter: (candidate: any) => {
          const render = candidate?.render ?? candidate;
          return (
            typeof render === 'function' &&
            String(render).includes('renderActionGroup') &&
            String(render).includes('dispatchMessageAction')
          );
        },
      },
      (Original) => (props) => {
        if (props.autoClogProps?.uiComponentName !== 'message_actions_menu' || !Array.isArray(props.actions))
          return <Original {...props} />;
        const tab = threadTabForMessage(
          props.channelId,
          props.ts,
          props.threadTs,
          this.api.redux.getStore()?.getState(),
        );
        if (!tab) return <Original {...props} />;
        return (
          <Original
            {...props}
            actions={addThreadTabAction(props.actions)}
            onSelectAction={(event, action, context) => {
              if (action?.id === THREAD_TAB_ACTION) {
                void this.openChat?.(tab);
                return true;
              }
              return props.onSelectAction?.(event, action, context);
            }}
          />
        );
      },
    );
    this.api.patchComponent('BaseSearch', (Original) => (props) => {
      const active = this.active.use();
      return active ? (
        <div className="slick-chat-tabs-search">
          <Original {...props} />
          <this.NewTabButton />
        </div>
      ) : (
        <Original {...props} />
      );
    });
    this.api.setStyle(`
      .slick-chat-tabs-layout { grid-area:p-view_contents--primary; flex:1; display:flex; flex-direction:column; height:100%; min-height:0; min-width:0; }
      .slick-chat-tabs-body { position:relative; display:flex; flex-direction:column; flex:1; min-height:0; min-width:0; }
      .slick-chat-tabs-layout .p-view_contents--primary { flex:1; min-height:0; }
      .slick-chat-tabs { flex:none; position:relative; background:var(--dt_color-base-pry, #fff); color:var(--dt_color-content-pry, #1d1c1d); border-bottom:1px solid var(--dt_color-otl-ter, #8885); }
      .slick-chat-tabs[hidden] { display:none; }
      .slick-chat-tabs__menu { position:fixed; inset:unset; margin:0; min-width:200px; padding:4px; border:1px solid var(--dt_color-otl-ter, #8885); border-radius:6px; background:var(--dt_color-base-pry, #fff); color:var(--dt_color-content-pry, #1d1c1d); box-shadow:0 4px 16px #0003; }
      .slick-chat-tabs__menu button { display:block; width:100%; padding:6px 12px; border:0; border-radius:3px; text-align:left; background:transparent; color:inherit; }
      .slick-chat-tabs__menu button:disabled { opacity:.4; }
      .slick-chat-tabs__menu button:enabled:is(:hover,:focus-visible) { background:var(--dt_color-base-hgl-1, #8882); outline:none; }
      .slick-chat-tabs[data-collapsed=true] { border-bottom:0; }
      .slick-chat-tabs-search { display:flex; align-items:center; gap:8px; min-width:0; width:100%; -webkit-app-region:no-drag; }
      .slick-chat-tabs-search > .p-top_nav__search__container { flex:1; min-width:0; }
      .slick-chat-tabs__new { display:flex; align-items:center; justify-content:center; flex:none; width:28px; height:28px; border:0; padding:4px; border-radius:5px; color:inherit; background:transparent; cursor:pointer; -webkit-app-region:no-drag; }
      .slick-chat-tabs__new:hover { background:color-mix(in srgb, currentColor 9%, transparent); }
      .slick-chat-tabs__new:focus-visible { outline:2px solid var(--dt_color-theme-base-inv-pry, #1264a3); }
      .slick-chat-tabs__row { display:flex; align-items:center; gap:4px; padding:5px 8px; }
      .slick-chat-tabs__list { display:flex; gap:4px; min-width:0; overflow-x:auto; scrollbar-width:thin; }
      .slick-chat-tabs__tab { display:flex; align-items:center; flex:none; max-width:220px; border-radius:6px; border:1px solid transparent; }
      .slick-chat-tabs__tab { position:relative; user-select:none; }
      .slick-chat-tabs__tab[data-dragging] { opacity:.45; }
      .slick-chat-tabs__tab[data-drop]::after { content:''; position:absolute; top:2px; bottom:2px; width:3px; border-radius:2px; background:var(--dt_color-theme-base-inv-pry, #1264a3); pointer-events:none; }
      .slick-chat-tabs__tab[data-drop=before]::after { left:-3px; }
      .slick-chat-tabs__tab[data-drop=after]::after { right:-3px; }
      .slick-chat-tabs__tab:has([aria-selected=true]) { background:var(--dt_color-base-sec, #8882); border-color:var(--dt_color-otl-ter, #8885); }
      .slick-chat-tabs button { color:inherit; background:transparent; border:0; border-radius:4px; cursor:pointer; }
      .slick-chat-tabs__tab:hover { background:color-mix(in srgb, currentColor 7%, transparent); }
      .slick-chat-tabs button:not(.slick-chat-tabs__select):hover { background:color-mix(in srgb, currentColor 9%, transparent); }
      .slick-chat-tabs button:focus-visible, .slick-chat-tabs input:focus-visible { outline:2px solid var(--dt_color-theme-base-inv-pry, #1264a3); outline-offset:-2px; }
      .slick-chat-tabs__select { display:flex; align-items:center; gap:7px; min-width:0; padding:6px 8px; }
      .slick-chat-tabs__name { overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
      .slick-chat-tabs__channel-icon { display:flex; flex:none; align-items:center; opacity:.85; }
      .slick-chat-tabs__avatars { display:flex; align-items:center; flex:none; padding-right:1px; }
      .slick-chat-tabs__avatar { display:block; width:20px; height:20px; flex:none; object-fit:cover; border-radius:5px; outline:2px solid var(--dt_color-base-pry, #fff); }
      .slick-chat-tabs__avatar + .slick-chat-tabs__avatar { margin-left:-6px; }
      .slick-chat-tabs__avatar--fallback { display:flex; align-items:center; justify-content:center; font-size:9px; font-weight:700; background:var(--dt_color-base-sec, #8883); }
      .slick-chat-tabs__close { padding:4px 8px; flex:none; font-size:19px; }
      .slick-chat-tabs__picker { position:fixed; z-index:1000; width:min(360px, 90vw); padding:10px; border:1px solid var(--dt_color-otl-ter, #8885); border-radius:8px; background:var(--dt_color-base-pry, #fff); color:var(--dt_color-content-pry, #1d1c1d); box-shadow:0 8px 24px #0003; }
      .slick-chat-tabs__picker input { width:100%; padding:8px; color:inherit; background:var(--dt_color-base-sec, #8881); border:1px solid var(--dt_color-otl-ter, #8885); border-radius:4px; }
      .slick-chat-tabs__results { max-height:280px; overflow-y:auto; margin-top:6px; }
      .slick-chat-tabs__results button { display:flex; align-items:center; gap:9px; width:100%; padding:8px; text-align:left; }
      .slick-chat-tabs__results button[aria-selected=true] { background:color-mix(in srgb, currentColor 8%, transparent); }
      .slick-chat-tabs__picker-heading { padding:9px 8px 3px; font-size:12px; opacity:.65; }
      .slick-chat-tabs__picker-name { overflow:hidden; white-space:nowrap; text-overflow:ellipsis; }
      .slick-chat-tabs__split-drop { position:fixed; right:8px; bottom:8px; width:clamp(160px, 30vw, 360px); z-index:1000; display:flex; flex-direction:column; gap:12px; align-items:center; justify-content:center; padding:20px; text-align:center; border:1px dashed currentColor; border-radius:8px; background:color-mix(in srgb, var(--dt_color-base-pry, #fff) 92%, transparent); color:var(--dt_color-content-pry, #1d1c1d); }
      .slick-chat-tabs__split-drop[data-over=true] { border-style:solid; box-shadow:inset 0 0 0 1px currentColor; }
      .slick-chat-tabs__split-drop > span { font-size:13px; opacity:.7; }
      .slick-chat-tabs__notice { padding:4px 12px; font-size:12px; }
    `);
    this.api.patchComponent<{ windowId?: string }>('ClientPrimaryView', (Original) => (props) => {
      const active = this.active.use();
      if (!active || (props.windowId && props.windowId !== 'main')) return <Original {...props} />;
      return (
        <div className="slick-chat-tabs-layout">
          <this.TabBar />
          <div className="slick-chat-tabs-body">
            <Original {...props} />
            <this.SplitDropTarget />
          </div>
        </div>
      );
    });
    // Slack's memoized layout needs an update to render a newly registered patch.
    queueMicrotask(() => {
      if (!this.api.signal.aborted) window.dispatchEvent(new Event('resize'));
    });
  }

  stop() {
    this.pickerTrigger.set(null);
    this.pickerOpen.set(false);
    this.draggedTab.set(null);
    this.active.set(false);
  }

  onSettingsChange() {
    this.settingsVersion.set(this.settingsVersion.get() + 1);
  }

  private NewTabButton = () => {
    const trigger = this.pickerTrigger.use();
    const open = this.pickerOpen.use();
    if (!trigger) return null;
    return (
      <button
        type="button"
        className="slick-chat-tabs__new slick-chat-tabs__add"
        aria-label="Open a chat tab"
        title="New Slick tab"
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={(event) => trigger(event.currentTarget)}
      >
        <this.api.elements.SvgIcon name="plus" size={18} />
      </button>
    );
  };

  private openSplit(tab: ChatTab) {
    const version = ++this.splitVersion;
    this.splitError.set('');
    this.splitNavigation = this.splitNavigation.then(async () => {
      if (this.api.signal.aborted || version !== this.splitVersion) return;
      try {
        const opened = await this.api.redux.dispatchThunk('openInSplitView', { navProps: splitProps(tab) });
        if (opened === false) throw new Error('Split navigation rejected');
      } catch {
        if (!this.api.signal.aborted && version === this.splitVersion)
          this.splitError.set('Could not open this chat in split view. Try dropping it again.');
      }
    });
  }

  private SplitDropTarget = () => {
    this.settingsVersion.use();
    const tab = this.draggedTab.use();
    const [over, setOver] = React.useState(false);
    const [top, setTop] = React.useState(0);
    React.useLayoutEffect(() => {
      setOver(false);
      if (!tab) return;
      const measure = () => setTop(document.querySelector('.slick-chat-tabs')?.getBoundingClientRect().bottom ?? 0);
      measure();
      window.addEventListener('resize', measure);
      return () => window.removeEventListener('resize', measure);
    }, [tab]);
    if (!tab || !this.config.dragToSplit) return null;
    return (
      <div
        className="slick-chat-tabs__split-drop"
        style={{ top: top + 6 }}
        data-over={over}
        role="region"
        aria-label="Open in split view"
        onDragOver={(event) => {
          if (!this.draggedTab.get()) return;
          event.preventDefault();
          event.stopPropagation();
          event.dataTransfer.dropEffect = 'move';
          setOver(true);
        }}
        onDragLeave={(event) => {
          if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setOver(false);
        }}
        onDrop={(event) => {
          const source = this.draggedTab.get();
          if (!source || event.dataTransfer.getData('application/x-slick-chat-tab') !== tabKey(source)) return;
          event.preventDefault();
          event.stopPropagation();
          this.draggedTab.set(null);
          this.splitError.set('');
          this.openSplit(source);
        }}
      >
        <svg width="40" height="32" viewBox="0 0 40 32" fill="none" aria-hidden="true">
          <rect x="2" y="2" width="36" height="28" rx="4" stroke="currentColor" strokeWidth="2" />
          <path
            d="M23 3v26M28 16h6m-3-3 3 3-3 3"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
        <strong>Open in split view</strong>
        <span>Drop here to keep both chats open</span>
      </div>
    );
  };

  private label(state: any, channelId: string, selfId?: string): string {
    const channel = state?.channels?.[channelId];
    if (channel && this.displayName) {
      try {
        const name = this.displayName(state, channel, { publicChannelIncludeHashSign: false, imIncludeAtSign: false });
        if (name) return name;
      } catch {}
    }
    return chatLabel(state, channelId, selfId);
  }

  private Avatar = ({ userId }: { userId: string }) => {
    const member = this.api.redux.useReduxState((state) => state.members?.[userId]);
    const url = member?.profile?.image_48 || member?.profile?.image_32 || member?.profile?.image_24;
    const [failed, setFailed] = React.useState<string | undefined>();
    const name = memberName(member, '?');
    return typeof url === 'string' && url.startsWith('https://') && failed !== url ? (
      <img className="slick-chat-tabs__avatar" src={url} alt="" draggable={false} onError={() => setFailed(url)} />
    ) : (
      <span className="slick-chat-tabs__avatar slick-chat-tabs__avatar--fallback">
        {name.slice(0, 1).toUpperCase()}
      </span>
    );
  };

  private TabAvatars = ({ channelId, selfId }: { channelId: string; selfId?: string }) => {
    const channel = this.api.redux.useReduxState((state) => state.channels?.[channelId]);
    if (!channel?.is_im && !channel?.is_mpim)
      return (
        <span className="slick-chat-tabs__channel-icon" aria-hidden="true">
          <this.api.elements.SvgIcon
            name={channel?.is_archived ? 'archive' : channel?.is_private || channel?.is_group ? 'lock' : 'channel'}
            size={16}
          />
        </span>
      );
    const members = chatMemberIds(channel, selfId);
    return (
      <span className="slick-chat-tabs__avatars" data-chat-type="dm" aria-hidden="true">
        {members.slice(0, 3).map((id) => (
          <this.Avatar key={id} userId={id} />
        ))}
        {members.length > 3 && (
          <span className="slick-chat-tabs__avatar slick-chat-tabs__avatar--fallback">+{members.length - 3}</span>
        )}
        {!members.length && <span className="slick-chat-tabs__avatar slick-chat-tabs__avatar--fallback">?</span>}
      </span>
    );
  };

  private TabLabel = ({ tab, selfId }: { tab: ChatTab; selfId?: string }) => {
    const label = this.api.redux.useReduxState((state) => this.label(state, tab.channel, selfId)) ?? tab.channel;
    const type = this.api.redux.useReduxState((state) => chatType(state.channels?.[tab.channel]));
    return (
      <>
        <this.TabAvatars channelId={tab.channel} selfId={selfId} />
        <span className="slick-chat-tabs__name" data-chat-type={type}>
          {label}
          {tab.thread ? ' · Thread' : ''}
        </span>
      </>
    );
  };

  private TabBar = () => {
    this.settingsVersion.use();
    const splitError = this.splitError.use();
    const activeSection = this.api.redux.useReduxState((state) => state.window?.main?.activeTab);
    const hidden = !this.config.showInActivity && (activeSection === 'activity' || activeSection === 'activity-inbox');
    const [route, setRoute] = React.useState(() => location.pathname + location.search);
    const team = getActiveTeam();
    const teamId = team?.id;
    const scope = teamId && team?.user_id ? `${teamId}:${team.user_id}` : null;
    const [saved, setSaved] = React.useState<{ scope: string; tabs: ChatTab[] } | null>(null);
    const [menu, setMenu] = React.useState<{ tab: ChatTab; x: number; y: number; anchor: HTMLElement } | null>(null);
    const [picker, setPicker] = React.useState(false);
    const [recents, setRecents] = React.useState<ChatTab[]>([]);
    const [pickerPosition, setPickerPosition] = React.useState({ top: 0, left: 0 });
    const draggedTab = this.draggedTab.use();
    const dragging = draggedTab ? tabKey(draggedTab) : null;
    const [drop, setDrop] = React.useState<{ key: string; after: boolean } | null>(null);
    const listRef = React.useRef<HTMLDivElement>(null);
    const scrollSpeed = React.useRef(0);
    const [notice, setNotice] = React.useState('');
    const pending = React.useRef(false);
    const addButton = React.useRef<HTMLButtonElement>(null);
    const pickerRef = React.useRef<HTMLDivElement>(null);
    const activeKey = this.api.redux.useReduxState((state) => {
      const candidate = currentTab(route, state, true);
      const savedThread =
        this.config.threadView === 'channel' &&
        candidate?.thread &&
        saved?.scope === scope &&
        saved.tabs.some((tab) => tabKey(tab) === tabKey(candidate));
      const tab = currentTab(route, state, this.config.autoThreadTabs || !!savedThread);
      return tab ? tabKey(tab) : undefined;
    });
    const [channel, thread] = activeKey?.split(':') ?? [];
    const current = channel ? { channel, ...(thread ? { thread } : {}) } : null;
    const tabs = saved?.scope === scope ? saved.tabs : [];

    React.useEffect(() => {
      if (!scope || !teamId || hidden) return;
      const trigger = (anchor: HTMLButtonElement) => {
        addButton.current = anchor;
        const currentPlace = currentTab(location.pathname + location.search, this.api.redux.getStore()?.getState());
        setRecents(
          restoreTabs([...(currentPlace ? [currentPlace] : []), ...recentPlaces(readLocalConfig().recents, teamId)]),
        );
        setPicker((value) => !value);
      };
      this.pickerTrigger.set(trigger);
      return () => {
        if (this.pickerTrigger.get() === trigger) this.pickerTrigger.set(null);
      };
    }, [scope, teamId, hidden]);

    React.useEffect(() => {
      if (hidden) {
        setPicker(false);
        setMenu(null);
      }
    }, [hidden]);

    React.useEffect(() => {
      this.pickerOpen.set(picker);
      return () => this.pickerOpen.set(false);
    }, [picker]);

    React.useLayoutEffect(() => {
      if (!picker) return;
      const position = () => {
        const anchor = addButton.current;
        if (!anchor?.isConnected) {
          setPicker(false);
          return;
        }
        const rect = anchor.getBoundingClientRect();
        const width = Math.min(360, innerWidth - 24);
        setPickerPosition({
          top: rect.bottom + 8,
          left: Math.max(12, Math.min(rect.right - width, innerWidth - width - 12)),
        });
      };
      position();
      window.addEventListener('resize', position);
      return () => window.removeEventListener('resize', position);
    }, [picker]);

    React.useEffect(() => {
      if (dragging && !tabs.some((tab) => tabKey(tab) === dragging)) this.draggedTab.set(null);
    }, [tabs, dragging]);

    React.useEffect(() => {
      if (!dragging) {
        setDrop(null);
        return;
      }
      let frame = 0;
      const scroll = () => {
        if (listRef.current && scrollSpeed.current) listRef.current.scrollLeft += scrollSpeed.current;
        frame = requestAnimationFrame(scroll);
      };
      frame = requestAnimationFrame(scroll);
      const cancel = () => this.draggedTab.set(null);
      const keydown = (event: KeyboardEvent) => {
        if (event.key === 'Escape') cancel();
      };
      document.addEventListener('dragend', cancel, true);
      document.addEventListener('keydown', keydown, true);
      return () => {
        cancelAnimationFrame(frame);
        scrollSpeed.current = 0;
        document.removeEventListener('dragend', cancel, true);
        document.removeEventListener('keydown', keydown, true);
      };
    }, [dragging]);

    React.useEffect(() => {
      listRef.current?.querySelector('[aria-selected=true]')?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    }, [activeKey, tabs.length]);

    React.useEffect(() => {
      const timer = setInterval(() => setRoute(location.pathname + location.search), 250);
      return () => clearInterval(timer);
    }, []);

    React.useEffect(() => {
      setPicker(false);
      setMenu(null);
      this.draggedTab.set(null);
      setDrop(null);
      setNotice('');
      if (!scope) return;
      let cancelled = false;
      void this.api.storage
        .get<unknown>(`tabs:${scope}`, [])
        .then((value) => {
          if (!cancelled) setSaved({ scope, tabs: restoreTabs(value) });
        })
        .catch(() => {
          if (!cancelled) {
            setSaved({ scope, tabs: [] });
            setNotice('Could not restore saved tabs.');
          }
        });
      return () => {
        cancelled = true;
      };
    }, [scope]);

    React.useEffect(() => {
      if (!current || !scope) return;
      setSaved((value) => {
        if (value?.scope !== scope) return value;
        const next = visitTab(value.tabs, current);
        return next === value.tabs ? value : { scope, tabs: next };
      });
    }, [activeKey, scope, saved?.scope]);

    React.useEffect(() => {
      if (!saved || saved.scope !== scope) return;
      const snapshot = saved;
      this.writes = this.writes
        .then(async () => {
          if (!(await this.api.storage.set(`tabs:${snapshot.scope}`, snapshot.tabs)))
            throw new Error('Storage unavailable');
        })
        .catch(() => {
          if (!this.api.signal.aborted) setNotice('Tabs could not be saved.');
        });
    }, [saved]);

    const open = async (tab: ChatTab) => {
      if (!teamId || pending.current) return;
      pending.current = true;
      setNotice('');
      this.splitError.set('');
      try {
        const besideChannel = !!tab.thread && this.config.threadView === 'channel';
        const before = this.api.redux.getStore()?.getState();
        const primary = before?.view?.[`v2::main::${before?.window?.main?.activeTab}::primary`];
        const sameChannel = !tab.thread && primary?.viewType === 'Channel' && primary.id === tab.channel;
        const result = sameChannel
          ? true
          : tab.thread && !besideChannel
            ? await this.api.redux.dispatchThunk('navigate', {
                ...splitProps(tab),
                options: { forceRenderInPrimary: true, forceBackStack: true },
              })
            : await this.api.redux.dispatchThunk('handleDeepLink', {
                uri: tabUri(teamId, tab),
                dangerouslyOverrideRouting: true,
              });
        if (result === false) {
          const destination = currentTab(
            location.pathname + location.search,
            this.api.redux.getStore()?.getState(),
            !!tab.thread,
          );
          if (!destination || tabKey(destination) !== tabKey(tab)) throw new Error('Navigation rejected');
        }
        {
          const state = this.api.redux.getStore()?.getState();
          const activeTab = state?.window?.main?.activeTab;
          if (!besideChannel && state?.view?.[`v2::main::${activeTab}::secondary`]?.viewType === 'Thread') {
            await this.api.redux.dispatchThunk('closeFlexpane', { shouldTransitionFocus: false });
          }
        }
        setSaved((value) => (value?.scope === scope ? { scope, tabs: visitTab(value.tabs, tab) } : value));
        setRoute(location.pathname + location.search);
        setPicker(false);
        return true;
      } catch {
        setNotice('Could not open this chat. Try opening it from Slack’s sidebar.');
        return false;
      } finally {
        pending.current = false;
      }
    };

    React.useEffect(() => {
      this.openChat = open;
      return () => {
        if (this.openChat === open) this.openChat = undefined;
      };
    }, [teamId, scope]);

    const close = async (tab: ChatTab, action: CloseTabsAction = 'close') => {
      if (pending.current) return;
      const result = closeTabs(tabs, tabKey(tab), activeKey, action, this.config.closeTabSelection);
      if (result.next && !(await open(result.next))) return;
      setSaved((value) => (value?.scope === scope ? { scope: value.scope, tabs: result.tabs } : value));
    };

    React.useEffect(() => {
      const closeCurrent = () => {
        const tab = tabs.find((entry) => tabKey(entry) === activeKey);
        if (tab && tabs.length > 1) void close(tab);
      };
      this.closeCurrent = closeCurrent;
      return () => {
        if (this.closeCurrent === closeCurrent) this.closeCurrent = undefined;
      };
    }, [tabs, activeKey]);

    const interceptClose = !hidden && tabs.length > 1 && !!activeKey;
    React.useEffect(() => {
      if (this.api.loader !== 'electron') return;
      void this.api.main.call('closeShortcut', interceptClose).catch(() => {});
      return () => {
        void this.api.main.call('closeShortcut', false).catch(() => {});
      };
    }, [interceptClose]);

    React.useEffect(() => {
      const handler = (event: KeyboardEvent) => {
        const direction = tabSwitchDirection(event);
        if (hidden || !direction || tabs.length < 2) return;
        const next = adjacentTab(tabs, activeKey, direction, this.config.wrapTabSwitching);
        event.preventDefault();
        event.stopImmediatePropagation();
        if (next) void open(next);
      };
      window.addEventListener('keydown', handler, true);
      return () => window.removeEventListener('keydown', handler, true);
    }, [tabs, activeKey, teamId, hidden]);

    React.useEffect(() => {
      if (!picker) return;
      const handler = (event: PointerEvent) => {
        if (!pickerRef.current?.contains(event.target as Node) && !addButton.current?.contains(event.target as Node))
          setPicker(false);
      };
      document.addEventListener('pointerdown', handler);
      return () => document.removeEventListener('pointerdown', handler);
    }, [picker]);

    if (!scope) return null;
    return (
      <div
        className="slick-chat-tabs"
        hidden={hidden}
        aria-label="Chat tabs"
        data-collapsed={tabs.length <= 1 && !this.config.showSingleTab}
        data-tab-count={tabs.length}
      >
        {(tabs.length > 1 || this.config.showSingleTab) && (
          <div className="slick-chat-tabs__row">
            <div
              className="slick-chat-tabs__list"
              ref={listRef}
              role="tablist"
              aria-label="Open chats"
              onDragOver={(event) => {
                if (!this.draggedTab.get()) return;
                event.preventDefault();
                event.stopPropagation();
                const bounds = event.currentTarget.getBoundingClientRect();
                scrollSpeed.current = dragScrollSpeed(event.clientX, bounds.left, bounds.right);
              }}
              onDragLeave={(event) => {
                if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
                  scrollSpeed.current = 0;
                  setDrop(null);
                }
              }}
            >
              {tabs.map((tab) => (
                <div
                  className="slick-chat-tabs__tab"
                  key={tabKey(tab)}
                  onContextMenu={(event) => {
                    event.preventDefault();
                    setMenu({
                      tab,
                      x: event.clientX,
                      y: event.clientY,
                      anchor: event.currentTarget.querySelector<HTMLElement>('[role=tab]')!,
                    });
                  }}
                  onKeyDown={(event) => {
                    if (event.key !== 'ContextMenu' && !(event.shiftKey && event.key === 'F10')) return;
                    event.preventDefault();
                    const rect = event.currentTarget.getBoundingClientRect();
                    setMenu({
                      tab,
                      x: rect.left,
                      y: rect.bottom,
                      anchor: event.currentTarget.querySelector<HTMLElement>('[role=tab]')!,
                    });
                  }}
                  draggable
                  data-tab-key={tabKey(tab)}
                  data-dragging={dragging === tabKey(tab) || undefined}
                  data-drop={drop?.key === tabKey(tab) ? (drop.after ? 'after' : 'before') : undefined}
                  onDragStart={(event) => {
                    if ((event.target as Element).closest('.slick-chat-tabs__close')) {
                      event.preventDefault();
                      return;
                    }
                    event.stopPropagation();
                    event.dataTransfer.effectAllowed = 'move';
                    event.dataTransfer.setData('application/x-slick-chat-tab', tabKey(tab));
                    this.splitError.set('');
                    this.draggedTab.set(tab);
                  }}
                  onDragOver={(event) => {
                    const source = this.draggedTab.get();
                    if (!source) return;
                    if (tabKey(source) === tabKey(tab)) {
                      setDrop(null);
                      return;
                    }
                    event.preventDefault();
                    event.dataTransfer.dropEffect = 'move';
                    const rect = event.currentTarget.getBoundingClientRect();
                    const after = event.clientX > rect.left + rect.width / 2;
                    setDrop((value) =>
                      value?.key === tabKey(tab) && value.after === after ? value : { key: tabKey(tab), after },
                    );
                  }}
                  onDrop={(event) => {
                    const source = this.draggedTab.get();
                    if (!source || event.dataTransfer.getData('application/x-slick-chat-tab') !== tabKey(source))
                      return;
                    event.preventDefault();
                    event.stopPropagation();
                    const rect = event.currentTarget.getBoundingClientRect();
                    const after = event.clientX > rect.left + rect.width / 2;
                    setSaved((value) =>
                      value?.scope === scope
                        ? { ...value, tabs: moveTab(value.tabs, tabKey(source), tabKey(tab), after) }
                        : value,
                    );
                    this.draggedTab.set(null);
                    setDrop(null);
                  }}
                  onDragEnd={() => {
                    this.draggedTab.set(null);
                    setDrop(null);
                  }}
                  onAuxClick={(event) => {
                    if (event.button === 1 && this.config.middleClickCloses && tabs.length > 1) {
                      event.preventDefault();
                      void close(tab);
                    }
                  }}
                >
                  <button
                    type="button"
                    role="tab"
                    aria-selected={tabKey(tab) === activeKey}
                    aria-keyshortcuts="Control+Tab Control+Shift+Tab Alt+Shift+ArrowLeft Alt+Shift+ArrowRight"
                    title="Switch tabs: Ctrl+Tab / Ctrl+Shift+Tab or Alt+Shift+Left/Right"
                    className="slick-chat-tabs__select"
                    onClick={() => void open(tab)}
                    onKeyDown={(event) => {
                      if (event.ctrlKey && event.shiftKey && ['ArrowLeft', 'ArrowRight'].includes(event.key)) {
                        event.preventDefault();
                        event.stopPropagation();
                        const neighbor = tabs[tabs.indexOf(tab) + (event.key === 'ArrowRight' ? 1 : -1)];
                        if (neighbor)
                          setSaved((value) =>
                            value?.scope === scope
                              ? {
                                  ...value,
                                  tabs: moveTab(value.tabs, tabKey(tab), tabKey(neighbor), event.key === 'ArrowRight'),
                                }
                              : value,
                          );
                        return;
                      }
                      if (!['ArrowLeft', 'ArrowRight', 'Home', 'End', 'Delete'].includes(event.key)) return;
                      event.preventDefault();
                      if (event.key === 'Delete') {
                        if (tabs.length > 1) void close(tab);
                        return;
                      }
                      const destination =
                        event.key === 'Home'
                          ? tabs[0]
                          : event.key === 'End'
                            ? tabs.at(-1)
                            : adjacentTab(
                                tabs,
                                tabKey(tab),
                                event.key === 'ArrowRight' ? 1 : -1,
                                this.config.wrapTabSwitching,
                              );
                      if (!destination) return;
                      const next = tabs.indexOf(destination);
                      const buttons = event.currentTarget
                        .closest('[role=tablist]')
                        ?.querySelectorAll<HTMLButtonElement>('[role=tab]');
                      buttons?.[next]?.focus();
                      void open(tabs[next]!);
                    }}
                  >
                    <this.TabLabel tab={tab} selfId={team?.user_id} />
                  </button>
                  {tabs.length > 1 && (
                    <button
                      type="button"
                      className="slick-chat-tabs__close"
                      aria-label={`Close tab ${tabs.indexOf(tab) + 1}`}
                      title={this.config.middleClickCloses ? 'Close tab (or middle-click)' : 'Close tab'}
                      onClick={() => void close(tab)}
                    >
                      ×
                    </button>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}
        {menu && !hidden && (
          <this.TabMenu
            menu={menu}
            tabs={tabs}
            dismiss={() => setMenu(null)}
            close={(action) => void close(menu.tab, action)}
          />
        )}
        {(notice || splitError) && (
          <div className="slick-chat-tabs__notice" role="status">
            {notice || splitError}
          </div>
        )}
        {picker && (
          <div
            className="slick-chat-tabs__picker"
            style={pickerPosition}
            ref={pickerRef}
            role="dialog"
            aria-label="Open a chat tab"
            onKeyDown={(event) => {
              if (event.key === 'Escape') {
                event.stopPropagation();
                setPicker(false);
                addButton.current?.focus();
              }
            }}
          >
            <this.ChatPicker recents={recents} open={(tab) => void open(tab)} />
          </div>
        )}
      </div>
    );
  };

  private TabMenu = ({
    menu,
    tabs,
    dismiss,
    close,
  }: {
    menu: { tab: ChatTab; x: number; y: number; anchor: HTMLElement };
    tabs: ChatTab[];
    dismiss: () => void;
    close: (action: CloseTabsAction) => void;
  }) => {
    const ref = React.useRef<HTMLDivElement>(null);
    const index = tabs.findIndex((tab) => tabKey(tab) === tabKey(menu.tab));
    React.useLayoutEffect(() => {
      const popup = ref.current!;
      popup.showPopover();
      const rect = popup.getBoundingClientRect();
      popup.style.left = `${Math.max(4, Math.min(menu.x, innerWidth - rect.width - 4))}px`;
      popup.style.top = `${Math.max(4, Math.min(menu.y, innerHeight - rect.height - 4))}px`;
      popup.querySelector<HTMLButtonElement>('button:enabled')?.focus();
      const outside = (event: PointerEvent) => {
        if (!popup.contains(event.target as Node)) dismiss();
      };
      const escape = (event: KeyboardEvent) => {
        if (event.key === 'Escape') {
          event.preventDefault();
          event.stopPropagation();
          dismiss();
          menu.anchor.focus();
        }
      };
      document.addEventListener('pointerdown', outside, true);
      document.addEventListener('keydown', escape, true);
      window.addEventListener('resize', dismiss);
      return () => {
        document.removeEventListener('pointerdown', outside, true);
        document.removeEventListener('keydown', escape, true);
        window.removeEventListener('resize', dismiss);
      };
    }, [menu]);
    const actions: [CloseTabsAction, string, boolean][] = [
      ['close', 'Close Tab', tabs.length <= 1],
      ['others', 'Close Other Tabs', tabs.length <= 1],
      ['left', 'Close Tabs to the Left', index <= 0],
      ['right', 'Close Tabs to the Right', index === tabs.length - 1],
      ['all', 'Close All Tabs', false],
    ];
    return (
      <div
        ref={ref}
        className="slick-chat-tabs__menu"
        popover="manual"
        role="menu"
        aria-label="Tab actions"
        onKeyDown={(event) => {
          if (event.key === 'Tab') {
            dismiss();
            return;
          }
          if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
          event.preventDefault();
          const buttons = [...event.currentTarget.querySelectorAll<HTMLButtonElement>('button:enabled')];
          const focused = buttons.indexOf(document.activeElement as HTMLButtonElement);
          buttons[
            event.key === 'Home'
              ? 0
              : event.key === 'End'
                ? buttons.length - 1
                : (focused + (event.key === 'ArrowDown' ? 1 : -1) + buttons.length) % buttons.length
          ]?.focus();
        }}
      >
        {actions.map(([action, label, disabled]) => (
          <button
            key={action}
            type="button"
            role="menuitem"
            disabled={disabled}
            onClick={() => {
              dismiss();
              close(action);
              menu.anchor.focus();
            }}
          >
            {label}
          </button>
        ))}
      </div>
    );
  };

  private ChatPicker = ({ recents, open }: { recents: ChatTab[]; open: (tab: ChatTab) => void }) => {
    const state = this.api.redux.useReduxState((value) => value);
    const [query, setQuery] = React.useState('');
    const [selected, setSelected] = React.useState(0);
    const resultsRef = React.useRef<HTMLDivElement>(null);
    const listId = React.useId();
    const selfId = getActiveTeam()?.user_id;
    const results = React.useMemo(() => {
      const channels = state?.channels;
      if (!channels) return [];
      const place = (tab: ChatTab, recent = false): PickerPlace => {
        const channel = channels[tab.channel];
        const members = chatMemberIds(channel, selfId).map((id) => {
          const member = state.members?.[id];
          return [member?.name, member?.real_name, member?.profile?.display_name, member?.profile?.real_name]
            .filter(Boolean)
            .join(' ');
        });
        return {
          tab,
          recent,
          label: this.label(state, tab.channel, selfId) + (tab.thread ? ' · Thread' : ''),
          searchText: [channel?.name, ...members].filter(Boolean).join(' '),
        };
      };
      const recent = recents
        .filter((tab) => channels[tab.channel] && !channels[tab.channel].isNonExistent)
        .map((tab) => place(tab, true));
      if (!query.trim() && recent.length) return searchPlaces(recent, query);
      const ids = new Set([...Object.keys(Object.getPrototypeOf(channels) ?? {}), ...Object.keys(channels)]);
      const conversations = [...ids]
        .filter(
          (id) =>
            /^[CDG][A-Z0-9]+$/.test(id) &&
            (channels[id]?.is_im || channels[id]?.is_mpim || channels[id]?.is_member) &&
            !channels[id]?.is_archived,
        )
        .map((channel) => place({ channel }));
      return searchPlaces([...recent, ...conversations], query);
    }, [state, query, recents, selfId]);
    const active = Math.min(selected, Math.max(0, results.length - 1));
    React.useEffect(() => {
      resultsRef.current?.querySelector(`[data-picker-index="${active}"]`)?.scrollIntoView({ block: 'nearest' });
    }, [active, query]);
    return (
      <>
        <input
          autoFocus
          value={query}
          role="combobox"
          autoComplete="off"
          spellCheck={false}
          aria-label="Find a conversation"
          aria-autocomplete="list"
          aria-expanded={true}
          aria-controls={listId}
          aria-activedescendant={results.length ? `${listId}-${active}` : undefined}
          placeholder="Find a channel, DM or thread…"
          onChange={(event) => {
            setQuery(event.target.value);
            setSelected(0);
          }}
          onKeyDown={(event) => {
            if (!['ArrowDown', 'ArrowUp', 'Enter'].includes(event.key)) return;
            event.preventDefault();
            event.stopPropagation();
            if (!results.length) return;
            if (event.key === 'Enter') open(results[active]!.tab);
            else setSelected((active + (event.key === 'ArrowDown' ? 1 : -1) + results.length) % results.length);
          }}
        />
        <div className="slick-chat-tabs__picker-heading">
          {query.trim() ? 'Conversations' : results.some((place) => place.recent) ? 'Recent places' : 'Conversations'}
        </div>
        <div
          className="slick-chat-tabs__results"
          role="listbox"
          id={listId}
          aria-label="Conversations"
          ref={resultsRef}
        >
          {results.map((place, index) => (
            <button
              type="button"
              role="option"
              id={`${listId}-${index}`}
              key={tabKey(place.tab)}
              data-picker-index={index}
              data-place-key={tabKey(place.tab)}
              aria-selected={active === index}
              onPointerMove={() => setSelected(index)}
              onClick={() => open(place.tab)}
            >
              <this.TabAvatars channelId={place.tab.channel} selfId={selfId} />
              <span
                className="slick-chat-tabs__picker-name"
                data-chat-type={chatType(state?.channels?.[place.tab.channel])}
              >
                {place.label}
              </span>
            </button>
          ))}
          {!results.length && <div role="status">No conversations found. Try another name.</div>}
        </div>
      </>
    );
  };
}
