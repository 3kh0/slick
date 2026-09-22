import { type LocalConfigTeam, readLocalConfig } from '../slack/localConfig.ts';

export const PENDING_ACCOUNT_SWITCH_KEY = 'slick:pendingAccountSwitch';

export type PendingAccountSwitch = {
  userId: string;
  teamId: string;
  team: LocalConfigTeam;
};

/** Apply the one-reload handoff before Slack reads its local configuration. */
export function applyPendingAccountSwitch(): void {
  let pending: string | null;
  try {
    pending = localStorage.getItem(PENDING_ACCOUNT_SWITCH_KEY);
    if (pending) localStorage.removeItem(PENDING_ACCOUNT_SWITCH_KEY);
  } catch {
    return;
  }
  if (!pending) return;

  let account: PendingAccountSwitch;
  try {
    account = JSON.parse(pending) as PendingAccountSwitch;
  } catch {
    return;
  }
  if (!account.teamId || !account.team?.token) return;

  const localConfig = readLocalConfig();
  localConfig.teams ??= {};
  localConfig.teams[account.teamId] = { ...localConfig.teams[account.teamId], ...account.team };
  localConfig.lastActiveTeamId = account.teamId;
  localConfig.orderedTeamIds ??= [];
  if (!localConfig.orderedTeamIds.includes(account.teamId)) localConfig.orderedTeamIds.push(account.teamId);

  try {
    localStorage.setItem('localConfig_v2', JSON.stringify(localConfig));
  } catch {}
}
