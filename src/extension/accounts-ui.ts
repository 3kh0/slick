import { extensionBrowser, validMethodResponse, type Method } from './rpc.ts';
import { ACCOUNT_PERMISSIONS, type AccountBrowser } from './accounts.ts';
import type { AccountSummary } from '../plugins/AccountSwitcher/types.ts';

type Status = {
  enabled: boolean;
  permission: boolean;
  busy: boolean;
  recovery: boolean;
  tabs: { id: number }[];
  accounts: AccountSummary[];
};
const api = extensionBrowser() as AccountBrowser | undefined;
if (!api) throw new Error('Open the account manager from Slick');
const element = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const status = element('account-status');
const source = element<HTMLSelectElement>('account-source');
let current: Status | undefined;
let busy = false;
async function call(method: Method, args: string[] = []) {
  const response = await api!.runtime.sendMessage({ method, args });
  if (!validMethodResponse(method, response)) throw new Error('Invalid account manager response');
  if (!response.ok) throw new Error(response.error);
  return response.value;
}
function report(message: string) {
  status.textContent = message;
}
function availability() {
  const ready = !!current?.enabled && !!current.permission && !busy && !current.busy && !current.recovery;
  element<HTMLFieldSetElement>('account-actions').disabled = !ready;
  element<HTMLButtonElement>('account-save').disabled = !ready || !source.value;
  element<HTMLButtonElement>('account-add').disabled = !ready || !source.value;
  element<HTMLButtonElement>('account-enable').disabled = busy || !current?.enabled;
  element<HTMLButtonElement>('account-recover').disabled = busy || !current?.permission;
  element<HTMLButtonElement>('account-refresh').disabled = busy;
  for (const button of document.querySelectorAll<HTMLButtonElement>('#account-list button'))
    button.disabled = busy || (button.dataset.action === 'switch' && !ready);
}
async function refresh() {
  current = JSON.parse((await call('account.status')) as string) as Status;
  const selected = source.value;
  source.replaceChildren();
  for (const tab of current.tabs) {
    const option = document.createElement('option');
    option.value = String(tab.id);
    option.textContent = `Slack tab ${tab.id}`;
    source.append(option);
  }
  if ([...source.options].some((o) => o.value === selected)) source.value = selected;
  element('account-enable').hidden = current.permission;
  element('account-recover').hidden = !current.recovery;
  const list = element('account-list');
  list.replaceChildren();
  for (const account of current.accounts.toSorted((a, b) => b.updatedAt - a.updatedAt)) {
    const row = document.createElement('li');
    const label = document.createElement('span');
    label.textContent = `${account.label || account.userId} · ${account.teamId}`;
    if (location.hash.slice(1) === account.userId) label.textContent += ' (selected from Slack)';
    row.append(label);
    for (const action of ['switch', 'forget'] as const) {
      const button = document.createElement('button');
      button.className = 'button';
      button.type = 'button';
      button.dataset.action = action;
      button.textContent = action === 'switch' ? 'Switch' : 'Remove saved account';
      button.addEventListener('click', () => {
        if (
          action === 'switch' &&
          !window.confirm(
            'Switch the Slack session for this browser profile? All Slack tabs will pause and cached Slack data, including unsent drafts, will be cleared.',
          )
        )
          return;
        void perform(
          async () => {
            if (action === 'switch') await call('account.switch', [account.userId, source.value]);
            else await call('account.forget', [account.userId]);
          },
          action === 'switch' ? 'Switched Slack accounts.' : 'Removed the saved account.',
        );
      });
      row.append(button);
    }
    list.append(row);
  }
  if (!current.accounts.length) list.textContent = 'No saved accounts yet.';
  report(
    !current.enabled
      ? 'Enable Account Switcher in Slick settings first.'
      : current.recovery
        ? 'A switch was interrupted. Recover your session before continuing.'
        : !current.permission
          ? 'Allow Slack session access to save and restore accounts.'
          : current.tabs.length
            ? 'Choose a Slack tab to save its signed-in account.'
            : 'Open and sign into Slack to save an account, or switch to a saved account below.',
  );
  availability();
}
async function perform(work: () => Promise<unknown>, message: string) {
  if (busy) return;
  busy = true;
  availability();
  report('Working…');
  try {
    await work();
    await refresh();
    report(message);
  } catch (error) {
    report(error instanceof Error ? error.message : 'Account action failed');
  } finally {
    busy = false;
    availability();
  }
}
element('account-enable').addEventListener('click', () => {
  // Invoke synchronously inside the user gesture; permission prompts need it.
  const permission = api.permissions.request(ACCOUNT_PERMISSIONS);
  void perform(async () => {
    if (!(await permission)) throw new Error('Slack session access was not granted.');
    if (current?.recovery) await call('account.recover');
  }, 'Slack session access enabled.');
});
element('account-save').addEventListener(
  'click',
  () =>
    void perform(
      () => call('account.capture', [source.value, element<HTMLInputElement>('account-label').value]),
      'Current account saved.',
    ),
);
element('account-add').addEventListener('click', () => {
  if (
    !window.confirm(
      'Save this account and start a fresh Slack sign-in? All Slack tabs will pause and cached Slack data, including unsent drafts, will be cleared.',
    )
  )
    return;
  void perform(
    () => call('account.add', [source.value]),
    'Previous account saved. Finish signing in, then return here to save the new account.',
  );
});
element('account-recover').addEventListener(
  'click',
  () => void perform(() => call('account.recover'), 'Recovered the Slack session.'),
);
element('account-refresh').addEventListener(
  'click',
  () => void refresh().catch((error) => report(String(error.message))),
);
source.addEventListener('change', availability);
void refresh().catch((error) => report(String(error.message)));
