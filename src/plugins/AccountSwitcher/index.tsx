// Adapted from Taut's AccountSwitcher (MIT, github.com/jeremy46231/taut).

import { SlickPlugin, type MenuTemplateItem } from '$slick';
import { PENDING_ACCOUNT_SWITCH_KEY, type PendingAccountSwitch } from '../../app/api/accounts.ts';
import { getActiveTeam, readLocalConfig } from '../../app/slack/localConfig.ts';
import * as meta from './meta.ts';
import type { AccountSummary } from './types.ts';

type MenuFromTemplateProps = { template?: MenuTemplateItem[] };
type AccountRowProps = {
  userId: string;
  isCurrent: boolean;
  onRemove: (userId: string) => void;
};

const SIGN_OUT_KEYS = ['sign-out', 'signout-submenu'];
const SWITCHER_KEY = 'slick-account-switcher';
const SLACK_URL = 'https://app.slack.com';

function orgKey(account: AccountSummary): string {
  return account.enterpriseId ?? account.teamId;
}

export default class AccountSwitcher extends SlickPlugin<typeof meta.settings> {
  static readonly id = meta.id;
  static readonly pluginName = meta.pluginName;
  static readonly description = meta.description;
  static readonly defaultEnabled = meta.defaultEnabled;
  static readonly settings = meta.settings;

  private accountsStore = new this.api.Store<AccountSummary[]>([]);
  private currentUserId: string | null = null;
  private currentOrgKey: string | null = null;
  private SvgIcon = this.api.elements.SvgIcon;
  private AccountRow: React.FC<AccountRowProps> = () => null;

  start() {
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

    void this.captureAndRefresh();
  }

  private async captureAndRefresh() {
    for (let attempt = 0; attempt < 10; attempt++) {
      if (this.api.signal.aborted) return;
      try {
        const current = await this.captureCurrent();
        if (current) {
          this.currentUserId = current.userId;
          this.currentOrgKey = orgKey(current);
          break;
        }
      } catch (error) {
        this.log('Account capture failed', error);
      }
      await this.delay(1_000);
    }
    if (!this.api.signal.aborted) await this.refresh();
  }

  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => {
      const onAbort = () => {
        clearTimeout(timer);
        resolve();
      };
      const timer = setTimeout(() => {
        this.api.signal.removeEventListener('abort', onAbort);
        resolve();
      }, ms);
      this.api.signal.addEventListener('abort', onAbort, { once: true });
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

  private async captureCurrent(): Promise<AccountSummary | null> {
    const { teamId, team } = this.activeTeam();
    if (!teamId || !team?.token || !team.user_id) return null;
    return this.api.main.call<AccountSummary>('capture', teamId, team);
  }

  private async refresh() {
    try {
      const all = await this.api.main.call<AccountSummary[]>('list');
      const scoped = this.currentOrgKey ? all.filter((account) => orgKey(account) === this.currentOrgKey) : all;
      const sorted = scoped.toSorted((a, b) => {
        if (a.userId === this.currentUserId) return -1;
        if (b.userId === this.currentUserId) return 1;
        return b.updatedAt - a.updatedAt;
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

  private async switchTo(userId: string) {
    try {
      await this.captureCurrent();
      const account = await this.api.main.call<PendingAccountSwitch>('switchTo', userId);
      localStorage.setItem(PENDING_ACCOUNT_SWITCH_KEY, JSON.stringify(account));
      location.assign(`${SLACK_URL}/client/${account.teamId}`);
    } catch (error) {
      this.log('Switch failed', error);
    }
  }

  private async addAccount() {
    try {
      await this.captureCurrent();
      const { localConfig, teamId, team } = this.activeTeam();
      const domain = team?.domain;
      await this.api.main.call('clearSession');

      if (teamId && localConfig.teams?.[teamId]) {
        delete localConfig.teams[teamId];
        localConfig.orderedTeamIds = (localConfig.orderedTeamIds ?? []).filter((id) => id !== teamId);
        delete localConfig.lastActiveTeamId;
        localStorage.setItem('localConfig_v2', JSON.stringify(localConfig));
      }

      if (domain === 'hackclub') {
        window.open('https://auth.hackclub.com', '_blank');
        location.reload();
      } else {
        location.assign(domain ? `https://${domain}.slack.com` : SLACK_URL);
      }
    } catch (error) {
      this.log('Add account failed', error);
    }
  }

  private makeAccountRow(): React.FC<AccountRowProps> {
    const { members } = this.api;
    const SvgIcon = this.SvgIcon;

    return function AccountRow({ userId, isCurrent, onRemove }) {
      const [removed, setRemoved] = React.useState(false);
      const [removeHovered, setRemoveHovered] = React.useState(false);
      const member = members.useMember(userId);
      const profile = member?.profile;
      const name = profile?.display_name || profile?.real_name || member?.real_name;
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
          {!isCurrent && (
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

  private buildSwitcherItem(accounts: AccountSummary[]): MenuTemplateItem {
    const AccountRow = this.AccountRow;
    const template: MenuTemplateItem[] = accounts.map((account) => {
      const isCurrent = account.userId === this.currentUserId;
      return {
        key: `slick-account-switcher__${account.userId}`,
        label: (
          <AccountRow
            userId={account.userId}
            isCurrent={isCurrent}
            onRemove={(userId) => void this.removeAccount(userId)}
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
