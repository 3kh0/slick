// Adapted from Taut's AccountSwitcher (MIT, github.com/jeremy46231/taut).

import { SlickPlugin, type MenuTemplateItem } from '$slick';

import { getActiveTeam, readLocalConfig } from '../../app/slack/localConfig.ts';
import * as meta from './meta.ts';
import {
  captureCandidate,
  scopedMemberId,
  workspaceSnapshot,
  savedWorkspaces,
  type SavedWorkspace,
  type WorkspaceAccountSummary,
} from './session.ts';
import { addSavedWorkspaceItems } from './workspaceMenu.ts';

type MenuFromTemplateProps = { template?: MenuTemplateItem[] };
type AccountRowProps = {
  userId: string;
  isCurrent: boolean;
  savedLabel?: string;
  onRemove: (userId: string) => void;
};

const SIGN_OUT_KEYS = ['sign-out', 'signout-submenu'];
const SWITCHER_KEY = 'slick-account-switcher';

function WorkspaceIcon({ workspace }: { workspace: SavedWorkspace }) {
  const [failed, setFailed] = React.useState(false);
  return workspace.iconUrl && !failed ? (
    <img
      src={workspace.iconUrl}
      alt=""
      width={36}
      height={36}
      style={{ borderRadius: '4px', objectFit: 'cover' }}
      onError={() => setFailed(true)}
    />
  ) : (
    <span aria-hidden="true">{workspace.name.slice(0, 1).toUpperCase()}</span>
  );
}

export default class AccountSwitcher extends SlickPlugin<typeof meta.settings> {
  static readonly requiredAPIs = ['elements', 'members'] as const;
  static readonly id = meta.id;
  static readonly pluginName = meta.pluginName;
  static readonly description = meta.description;
  static readonly defaultEnabled = meta.defaultEnabled;
  static readonly settings = meta.settings;

  private accountsStore = new this.api.Store<WorkspaceAccountSummary[]>([]);
  private workspacesStore = new this.api.Store<SavedWorkspace[]>([]);
  private currentUserId: string | null = null;
  private currentTeamId: string | null = null;
  private currentEnterpriseId: string | null = null;
  private sessionRevision = 0;
  private wakeCapture: (() => void) | undefined;
  private SvgIcon = this.api.elements.SvgIcon;
  private AccountRow: React.FC<AccountRowProps> = () => null;

  start() {
    this.api.main.on('session-changed', () => {
      this.sessionRevision++;
      this.wakeCapture?.();
    });
    this.AccountRow = this.makeAccountRow();

    this.api.patchComponent<MenuFromTemplateProps>('MenuFromTemplate', (Original) => (props) => {
      const accounts = this.accountsStore.use();
      const template = props.template;
      if (Array.isArray(template)) {
        const index = template.findIndex((item) => item && SIGN_OUT_KEYS.includes(item.key));
        const already = template.some((item) => item?.key === SWITCHER_KEY);
        if (index !== -1 && !already) {
          const next = [...template.slice(0, index), this.buildSwitcherItem(accounts), ...template.slice(index)];
          return <Original {...props} template={next} />;
        }
      }
      return <Original {...props} />;
    });

    if (this.api.loader !== 'extension') {
      this.api.patchComponent<{ menuClassNames?: string; children?: React.ReactNode }>(
        'Menu',
        (Original) => (props) => {
          const workspaces = this.workspacesStore.use();
          if (!props.menuClassNames?.split(' ').includes('p-team_switcher_menu') || !Array.isArray(props.children))
            return <Original {...props} />;
          const children = props.children as React.ReactElement<{
            onSelected?: () => void;
            children?: React.ReactNode;
          }>[];
          const next = addSavedWorkspaceItems(children, workspaces, (source, workspace) =>
            React.cloneElement(source, {
              key: `slick-saved-workspace__${workspace.teamId}`,
              onSelected: () => void this.switchTo(workspace.accountId, workspace.teamId),
              children: (
                <div className="p-add_team_label" data-slick-saved-workspace={workspace.teamId}>
                  <div className="p-add_team_label__icon" aria-hidden="true">
                    <WorkspaceIcon key={workspace.iconUrl ?? workspace.teamId} workspace={workspace} />
                  </div>
                  <div>
                    <div>{workspace.name}</div>
                    <div style={{ fontSize: '12px', opacity: 0.7 }}>
                      {workspace.domain ? `${workspace.domain}.slack.com` : 'Saved workspace'}
                    </div>
                  </div>
                </div>
              ),
            }),
          );
          return <Original {...props} children={next} />;
        },
      );
    }

    void (this.api.loader === 'extension' ? this.refreshBrowserAccounts() : this.captureAndRefresh());
  }

  private async refreshBrowserAccounts() {
    // Only summaries cross the page bridge. Saving and switching sessions require
    // a click in the extension's account manager, never a forgeable page request.
    while (!this.api.signal.aborted) {
      this.updateCurrentScope();
      await this.refresh();
      await this.delay(2_000);
    }
  }

  private async captureAndRefresh() {
    let captured = '';
    await this.refresh();
    // Redirect logins can update the running client after plugin startup.
    // Keep retrying until localConfig catches up, but do not recapture unchanged sessions.
    while (!this.api.signal.aborted) {
      let retryDelay = 2_000;
      try {
        const { localConfig, teamId } = this.activeTeam();
        const liveUserId = this.api.members.getCurrentMemberId();
        const team = captureCandidate(localConfig, teamId, liveUserId);
        if (this.updateCurrentScope()) await this.refresh();
        const snapshot = workspaceSnapshot(localConfig);
        const signature = team ? JSON.stringify([this.sessionRevision, teamId, team, snapshot]) : '';
        if (signature && signature !== captured) {
          const current = await this.api.main.call<WorkspaceAccountSummary>('capture', teamId, team, snapshot);
          if (current && !this.api.signal.aborted) {
            captured = signature;
            this.updateCurrentScope();
            await this.refresh();
          }
        }
      } catch (error) {
        this.log('Account capture failed', error);
        retryDelay = 10_000;
      }
      await this.delay(retryDelay);
    }
  }

  private delay(ms: number): Promise<void> {
    if (this.api.signal.aborted) return Promise.resolve();
    return new Promise((resolve) => {
      const finish = () => {
        clearTimeout(timer);
        this.api.signal.removeEventListener('abort', finish);
        if (this.wakeCapture === finish) this.wakeCapture = undefined;
        resolve();
      };
      const timer = setTimeout(finish, ms);
      this.wakeCapture = finish;
      this.api.signal.addEventListener('abort', finish, { once: true });
    });
  }

  private activeTeam() {
    const localConfig = readLocalConfig();
    const route = /^\/client\/([^/]+)/.exec(location.pathname)?.[1];
    let teamId = localConfig.lastActiveTeamId;
    if (route) {
      try {
        teamId = decodeURIComponent(route);
      } catch {
        teamId = route;
      }
    }
    return { localConfig, teamId, team: getActiveTeam(localConfig) };
  }

  private updateCurrentScope(): boolean {
    const { teamId, team } = this.activeTeam();
    const userId = this.api.members.getCurrentMemberId() ?? null;
    const enterpriseId =
      typeof team?.enterprise_id === 'string' ? team.enterprise_id : teamId?.startsWith('E') ? teamId : null;
    const changed =
      userId !== this.currentUserId ||
      (teamId ?? null) !== this.currentTeamId ||
      enterpriseId !== this.currentEnterpriseId;
    this.currentUserId = userId;
    this.currentTeamId = teamId ?? null;
    this.currentEnterpriseId = enterpriseId;
    return changed;
  }

  private memberId(account: WorkspaceAccountSummary) {
    return scopedMemberId(account, this.currentTeamId, this.currentEnterpriseId);
  }

  private async captureCurrent(): Promise<WorkspaceAccountSummary | null> {
    const { localConfig, teamId } = this.activeTeam();
    const team = captureCandidate(localConfig, teamId, this.api.members.getCurrentMemberId());
    if (!teamId || !team) return null;
    return this.api.main.call<WorkspaceAccountSummary>('capture', teamId, team, workspaceSnapshot(localConfig));
  }

  private async refresh() {
    try {
      const all = await this.api.main.call<WorkspaceAccountSummary[]>('list');
      this.workspacesStore.set(savedWorkspaces(all));
      const scoped = all.filter((account) => this.memberId(account));
      const sorted = scoped.toSorted((a, b) => {
        const currentOrder =
          Number(this.memberId(b) === this.currentUserId) - Number(this.memberId(a) === this.currentUserId);
        return currentOrder || b.updatedAt - a.updatedAt;
      });
      this.accountsStore.set(sorted);
    } catch (error) {
      this.log('Failed to refresh accounts', error);
    }
  }

  private async removeAccount(userId: string) {
    try {
      await this.api.main.call('forget', userId);
    } catch (error) {
      this.log('Failed to remove account', error);
    }
    await this.refresh();
  }

  private async switchTo(userId: string, teamId?: string) {
    try {
      if (this.api.loader === 'extension') {
        await this.api.main.call('open', userId);
        return;
      }
      try {
        await this.captureCurrent();
      } catch (error) {
        throw new Error(
          `Saving the current account failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
          { cause: error },
        );
      }
      await this.api.main.call('switchTo', userId, teamId ?? this.activeTeam().teamId).catch((error: unknown) => {
        throw new Error(
          `Verifying or restoring the target account failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
          { cause: error },
        );
      });
    } catch (error) {
      this.log('Switch failed', error);
      window.alert(`Could not switch accounts.\n\n${error instanceof Error ? error.message : 'Please try again.'}`);
    }
  }

  private async addAccount() {
    try {
      if (this.api.loader === 'extension') {
        await this.api.main.call('open');
        return;
      }
      await this.captureCurrent();
      const { team } = this.activeTeam();
      await this.api.main.call('addAccount', team?.domain);
    } catch (error) {
      this.log('Add account failed', error);
    }
  }

  private makeAccountRow(): React.FC<AccountRowProps> {
    const { members } = this.api;
    const canRemove = this.api.loader !== 'extension';
    const SvgIcon = this.SvgIcon;

    return function AccountRow({ userId, isCurrent, onRemove, savedLabel }) {
      const [removed, setRemoved] = React.useState(false);
      const [removeHovered, setRemoveHovered] = React.useState(false);
      const member = members.useMember(userId);
      const profile = member?.profile;
      const name = profile?.display_name || profile?.real_name || member?.real_name || savedLabel;
      const avatar = profile?.image_48;

      if (removed) return null;
      return (
        <span
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
            flex: '1 1 auto',
            minWidth: 0,
            position: 'relative',
            top: '1px',
          }}
        >
          <span
            style={{
              width: '20px',
              height: '20px',
              flex: '0 0 auto',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            {isCurrent && <SvgIcon name="check-filled" size={16} inline />}
          </span>
          {avatar ? (
            <img src={avatar} alt="" width={20} height={20} style={{ borderRadius: '4px', flex: '0 0 auto' }} />
          ) : (
            <span
              style={{
                width: '20px',
                height: '20px',
                borderRadius: '4px',
                flex: '0 0 auto',
                background: 'rgba(var(--sk_foreground_low_solid, 221, 221, 221), 0.1)',
              }}
            />
          )}
          {name ? (
            <span
              style={{
                flex: '1 1 auto',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
              }}
            >
              {name}
            </span>
          ) : (
            <span
              style={{
                flex: '0 1 90px',
                height: '12px',
                borderRadius: '4px',
                background: 'rgba(var(--sk_foreground_low_solid, 221, 221, 221), 0.1)',
              }}
            />
          )}
          {!isCurrent && canRemove && (
            <button
              type="button"
              aria-label="Remove account"
              title="Remove account"
              onClick={(event) => {
                event.preventDefault();
                event.stopPropagation();
                setRemoved(true);
                onRemove(userId);
              }}
              onMouseEnter={() => setRemoveHovered(true)}
              onMouseLeave={() => setRemoveHovered(false)}
              style={{
                width: '20px',
                height: '20px',
                flex: '0 0 auto',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                cursor: 'pointer',
                borderRadius: '4px',
                border: 0,
                padding: 0,
                color: removeHovered ? '#fff' : 'var(--sk_error, #e01e5a)',
                opacity: removeHovered ? 1 : 0.6,
                background: removeHovered ? 'var(--sk_error, #e01e5a)' : 'transparent',
                transition: 'background-color 0.1s ease, opacity 0.1s ease, color 0.1s ease',
              }}
            >
              <SvgIcon name="trash-filled" size={16} inline />
            </button>
          )}
        </span>
      );
    };
  }

  private buildSwitcherItem(accounts: WorkspaceAccountSummary[]): MenuTemplateItem {
    const AccountRow = this.AccountRow;
    const template: MenuTemplateItem[] = accounts
      .filter((account) => this.memberId(account))
      .map((account) => {
        const userId = this.memberId(account)!;
        const isCurrent = userId === this.currentUserId;
        return {
          key: `slick-account-switcher__${account.userId}`,
          label: (
            <AccountRow
              userId={userId}
              isCurrent={isCurrent}
              savedLabel={account.label}
              onRemove={() => void this.removeAccount(account.userId)}
            />
          ),
          click: isCurrent ? undefined : () => void this.switchTo(account.userId),
        };
      });

    if (template.length) template.push({ key: 'slick-account-switcher__separator', type: 'separator' });
    template.push({
      key: 'slick-account-switcher__add',
      label: 'Add another account',
      click: () => void this.addAccount(),
    });

    return { key: SWITCHER_KEY, label: 'Switch account', type: 'submenu', template };
  }
}
