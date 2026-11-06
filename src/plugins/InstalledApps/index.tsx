// ported from Fantamomo's code: https://github.com/jeremy46231/taut/pull/33
// but this version is better since it requires no tokens :D
import { SlickPlugin } from '$slick';
import { appSessions, sessionRequest, type SessionChoice } from './session.ts';
import { getActiveTeam, readLocalConfig } from '../../app/slack/localConfig.ts';
import { listInstalledApps, type AppPageData, type InstalledApp } from './data.ts';
import * as meta from './meta.ts';

type AppProps = {
  appId?: string;
  appUserId?: string;
  memberId?: string;
};

type ProfileShellProps = {
  profileId?: string;
  uiComponentName?: string;
  children?: React.ReactNode;
};

export default class InstalledApps extends SlickPlugin<typeof meta.settings> {
  static readonly id = meta.id;
  static readonly pluginName = meta.pluginName;
  static readonly description = meta.description;
  static readonly category = meta.category;
  static readonly defaultEnabled = meta.defaultEnabled;
  static readonly settings = meta.settings;
  static readonly requiredAPIs = ['members', 'elements', 'redux'] as const;

  private active = new this.api.Store(false);
  private sessionChoice: SessionChoice & { account?: string } = {};

  private installsCache = this.api.Cache<InstalledApp[]>('installs-v2', 30 * 60_000, 200);
  private appPageCache = this.api.Cache<AppPageData>('marketplace-v2', 60 * 60_000, 100);

  start() {
    this.active.set(true);
    this.api.signal.addEventListener('abort', () => this.active.set(false), { once: true });
    // patching the Content component to add the AppInstallersBlock on the app profile page
    this.api.patchComponent<{ children?: unknown }>('Content', (Original) => (props) => {
      if (!this.active.use()) return <Original {...props} />;
      const children = props.children;
      if (!React.isValidElement<ProfileShellProps>(children)) return <Original {...props} />;
      const existing = children.props.children;
      if (!Array.isArray(existing)) return <Original {...props} />;

      // This is the profile's scrollable body, after bio, recent DMs, and custom fields.
      // Match the known shell directly; no DOM observer or recursive profile scan.
      const userId = children.props.profileId;
      if (
        children.props.uiComponentName === 'rimeto_member_profile_flexpane' &&
        userId &&
        /^[UW][A-Z0-9]+$/.test(userId)
      ) {
        const sections = existing.map((child) => {
          if (
            !React.isValidElement<{ 'data-qa'?: string; children?: React.ReactNode }>(child) ||
            child.props['data-qa'] !== 'member_profile_pane'
          )
            return child;
          return React.cloneElement(
            child,
            undefined,
            child.props.children,
            <this.InstalledAppsBlock key="slick-installed-apps" userId={userId} profile />,
          );
        });
        return <Original {...props} children={React.cloneElement(children, undefined, ...sections)} />;
      }

      // finding the AppDetailsOverflow component, which contains all the info we need
      // (I tried patching AppDetailsOverflow but then the resulting layout was broken with no way (that i know) to fix it)
      const info = this.findAppDetailsOverflow(props.children);
      const appId = info?.appId;

      if (!appId) return <Original {...props} />;

      const newChildren = [...existing, <this.AppInstallersBlock key="slick-app-installers" appId={info.appId} />];

      return <Original {...props} children={React.cloneElement(children, undefined, ...newChildren)} />;
    });

    // patching the AboutPage component to add the AppInstallersBlock on the apps about page
    this.api.patchComponent<{
      appId?: string;
      children?: unknown;
    }>('AboutPage', (Original) => (props) => {
      if (!this.active.use()) return <Original {...props} />;
      const appId = props.appId;
      if (!appId || !appId.startsWith('A')) return <Original {...props} />;

      // the wrappers are necessary so that a scroll bar is shown
      return (
        <div className="slick-about-scroll-wrapper">
          <div className="slick-about-scroll-wrapper__original">
            <Original {...props} />
          </div>
          <this.AppInstallersBlock key="slick-app-installers" appId={appId} app_about_screen={true} />
        </div>
      );
    });

    this.injectStyles();
    this.log('Started');
  }

  stop() {
    this.active.set(false);
  }

  private findAppDetailsOverflow(node: unknown, depth = 0): AppProps | undefined {
    if (!node || depth > 12) return undefined;

    if (Array.isArray(node)) {
      for (const child of node) {
        const found = this.findAppDetailsOverflow(child, depth + 1);
        if (found) return found;
      }
      return undefined;
    }

    if (typeof node !== 'object') return undefined;

    const props = (node as any)?.props;
    if (this.isProfileProps(props)) return props as AppProps;

    if (props?.children) return this.findAppDetailsOverflow(props.children, depth + 1);
    return undefined;
  }

  private isProfileProps(obj: unknown): obj is AppProps {
    if (typeof obj !== 'object' || obj === null) {
      return false;
    }

    const profile = obj as Record<string, unknown>;

    return typeof profile.appId === 'string' && typeof profile.appUserId === 'string';
  }

  private accountKey(): string | null {
    const team = getActiveTeam();
    return team?.id && team.user_id ? `${team.id}:${team.user_id}` : null;
  }

  private useData<T>(id: string | undefined, cache: ReturnType<typeof this.api.Cache<T>>, fetcher: () => Promise<T>) {
    const account = this.accountKey();
    const key = account && id ? `${account}:${id}` : null;
    const [state, setState] = React.useState<{ key: string; value: T } | null>(null);
    const [errorKey, setErrorKey] = React.useState<string | null>(null);
    React.useEffect(() => {
      let active = true;
      if (key && cache.peek(key) !== undefined) return;
      if (key)
        void cache
          .get(key, async () => {
            if (account !== this.accountKey() || !this.api.isActive()) throw new Error('Account changed');
            const value = await fetcher();
            if (account !== this.accountKey() || !this.api.isActive()) throw new Error('Account changed');
            return value;
          })
          .then((value) => {
            if (active && this.api.isActive() && account === this.accountKey()) setState({ key, value });
          })
          .catch(() => {
            if (active && this.api.isActive()) setErrorKey(key);
          });
      return () => {
        active = false;
      };
    }, [key]);
    return { value: key ? (state?.key === key ? state.value : cache.peek(key)) : undefined, failed: errorKey === key };
  }

  private useInstalledApps(userId: string | undefined) {
    return this.useData(userId, this.installsCache, () => {
      const config = readLocalConfig();
      const team = getActiveTeam(config);
      const account = team?.id && team.user_id ? `${team.id}:${team.user_id}` : undefined;
      if (account !== this.sessionChoice.account) this.sessionChoice = { account };
      const sessions = appSessions(team, config);
      const choice = this.sessionChoice;
      return listInstalledApps(userId!, (params) => sessionRequest(sessions, params, this.api.signal, fetch, choice));
    });
  }

  private appProfileHref(appId: string): string {
    return `slack://app?id=${appId}&tab=about`;
  }

  // Web builds have no slack: protocol handler, so Slack's own deep link handling opens the app.
  private openApp = (event: React.MouseEvent<HTMLAnchorElement>) => {
    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    event.preventDefault();
    void this.api.redux.dispatchThunk('handleDeepLink', { uri: event.currentTarget.href });
  };

  private InstalledAppsBlock = (props: { userId?: string; profile?: boolean }) => {
    const className = `slick-installed-apps${props.profile ? ' p-r_member_profile_section slick-installed-apps-profile' : ''}`;
    const { value: apps, failed } = this.useInstalledApps(props.userId);
    if (!apps)
      return failed ? (
        <div className={className} role="status">
          Installed apps unavailable for this session.
        </div>
      ) : null;
    if (apps.length === 0) return null;

    return (
      <div className={className}>
        <div className="slick-installed-apps__heading">Installed apps ({apps.length})</div>
        <div className="slick-installed-apps__grid">
          {apps.map((app) => {
            const icon = app.icon;
            const isOfficial = app.is_app_directory_approved || app.is_certified;
            return (
              <a
                key={app.id}
                className={`slick-installed-apps__item ${isOfficial ? 'slick-installed-apps__item-official' : 'slick-installed-apps__item-internal'}`}
                href={this.appProfileHref(app.id)}
                onClick={this.openApp}
                title={app.description || app.name}
                rel="noreferrer"
              >
                {icon ? (
                  <img className="slick-installed-apps__icon" src={icon} alt="" />
                ) : (
                  <span className="slick-installed-apps__icon slick-installed-apps__icon--placeholder" />
                )}
                <span className="slick-installed-apps__name">{app.name}</span>
              </a>
            );
          })}
        </div>
      </div>
    );
  };

  // --- who installed an app ------------------------------------------------

  private async fetchAppPage(appId: string): Promise<AppPageData> {
    const team = getActiveTeam();
    if (!team?.id || !team.user_id) throw new Error('No active workspace');
    return this.api.main.call<AppPageData>('marketplace', appId, team.id);
  }

  private useAppData(appId: string | undefined) {
    return this.useData(appId, this.appPageCache, () => this.fetchAppPage(appId!)).value;
  }

  /** one avatar + name row for a single authorized user */
  private InstallerRow = (props: { userId: string; fallbackName: string }) => {
    const user = this.api.members.useMember(props.userId);

    const name =
      user?.profile?.display_name || user?.profile?.real_name || user?.real_name || user?.name || props.fallbackName;

    const avatar = user?.profile?.image_48;

    return (
      <div className="slick-app-installers__row">
        {avatar ? (
          <img className="slick-app-installers__avatar" src={avatar} alt="" />
        ) : (
          <span className="slick-app-installers__avatar slick-app-installers__avatar--placeholder" />
        )}
        {this.api.elements.MrkdwnElement ? (
          <this.api.elements.MrkdwnElement text={`<@${props.userId}>`} />
        ) : (
          <span className="slick-app-installers__name">{name}</span>
        )}
      </div>
    );
  };

  private ChannelMentions = (props: { channelIds: string[] }) => {
    const Mrkdwn = this.api.elements.MrkdwnElement;
    if (!Mrkdwn) return <>{props.channelIds.join(', ')}</>;

    const text = props.channelIds.map((id) => `<#${id}>`).join('  ');
    return <Mrkdwn text={text} />;
  };

  private AppInstallersBlock = (props: { appId?: string; app_about_screen?: boolean }) => {
    const data = this.useAppData(props.appId);
    const auths = data?.authorizations;
    const memberships = data?.memberships;

    if (!data || (!auths?.length && !memberships?.length && !data.otherGroups)) return null;

    return (
      <div className={`p-app_space_profile__section slick-app-installers slick-app-installers-app`}>
        <div className="slick-app-installers__heading">Installed / authorized by ({auths?.length ?? 0})</div>
        <div className="slick-app-installers__list">
          {auths?.map((auth) => (
            <this.InstallerRow key={auth.userId} userId={auth.userId} fallbackName={auth.name} />
          ))}
        </div>
        {memberships && (memberships.length > 0 || !!data?.otherGroups) ? (
          <div
            className={`slick-app-installers__memberships${props.app_about_screen ? ' slick-app-installers__memberships--about-screen' : ''}`}
          >
            <div className="slick-app-installers__memberships-label">
              In {memberships.length} channel
              {memberships.length === 1 ? '' : 's'}
              {data?.otherGroups ? ` (+${data.otherGroups} more you can't see)` : ''}:
            </div>
            <this.ChannelMentions channelIds={memberships} />
          </div>
        ) : null}
      </div>
    );
  };

  private injectStyles() {
    this.api.setStyle(`
      .slick-installed-apps, .slick-app-installers {
        padding: 10px 0px;
        border-top: 1px solid rgba(var(--sk_foreground_low, #1d1c1d), .13);
      }
      .slick-app-installers-app {
        padding: 10px 20px;
      }
      .slick-installed-apps.slick-installed-apps-profile {
        display: block;
        padding: 16px;
        border-top: 0;
      }
      .slick-installed-apps__heading, .slick-app-installers__heading {
        font-size: 11px;
        font-weight: 700;
        letter-spacing: 0.02em;
        text-transform: uppercase;
        opacity: 0.6;
        margin-bottom: 8px;
      }
      .slick-installed-apps__grid {
        display: flex;
        flex-wrap: wrap;
        gap: 8px;
      }
      .slick-installed-apps__item {
        display: flex;
        align-items: center;
        gap: 6px;
        padding: 4px 8px;
        border-radius: 6px;
        background: rgba(134, 134, 134, 0.09);
        color: inherit;
        text-decoration: none;
        font-size: 12px;
        max-width: 160px;
      }
      .slick-installed-apps__item-official {
        background: rgba(0, 122, 90, 0.10);
      }
      .slick-installed-apps__item-internal {
        background: rgba(134, 134, 134, 0.09);
      }
      .slick-installed-apps__item:hover {
        background: rgba(134, 134, 134, 0.16);
      }
      .slick-installed-apps__item-official:hover {
        background: rgba(0, 122, 90, 0.16);
      }
      .slick-installed-apps__icon {
        width: 16px;
        height: 16px;
        border-radius: 4px;
        flex-shrink: 0;
      }
      .slick-installed-apps__icon--placeholder {
        background: rgba(134, 134, 134, 0.3);
      }
      .slick-installed-apps__name {
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      .slick-app-installers__list {
        display: flex;
        flex-direction: column;
        gap: 6px;
        max-height: 260px;
        overflow-y: auto;
      }
      .slick-app-installers__row {
        display: flex;
        align-items: center;
        gap: 8px;
        font-size: 13px;
      }
      .slick-app-installers__avatar {
        width: 24px;
        height: 24px;
        border-radius: 6px;
        flex-shrink: 0;
        object-fit: cover;
      }
      .slick-app-installers__avatar--placeholder {
        background: rgba(134, 134, 134, 0.3);
      }
      .slick-app-installers__memberships {
        margin-top: 10px;
        font-size: 12px;
        min-width: 0;
        overflow-wrap: anywhere;
      }
      .slick-app-installers__memberships--about-screen {
        max-height: clamp(100px, 30vh, 400px);
        overflow-y: auto;
        overscroll-behavior: contain;
        padding-right: 4px;
      }
      .slick-app-installers__memberships-label {
        opacity: 0.7;
        margin-bottom: 4px;
      }
      .slick-about-scroll-wrapper {
        display: flex;
        flex-direction: column;
        flex: 1 1 auto;
        height: 100%;
        min-height: 0;
        width: 100%;
        overflow-y: auto;
        overscroll-behavior: contain;
      }
      .slick-about-scroll-wrapper__original,
      .slick-about-scroll-wrapper > .slick-app-installers {
        flex: 0 0 auto;
      }
    `);
  }
}
