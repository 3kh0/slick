import assert from 'node:assert/strict';
import { test } from 'node:test';
import { savedWorkspaces, workspaceIconUrl } from './session.ts';
import { addSavedWorkspaceItems, SAVED_WORKSPACE_PREFIX } from './workspaceMenu.ts';

const hack = {
  userId: 'U111111',
  teamId: 'EHACK00',
  updatedAt: 1,
  workspaces: {
    EHACK00: { userId: 'U111111', name: 'Hack Club', domain: 'hackclub' },
    THACK00: { userId: 'U111111', enterpriseId: 'EHACK00', name: 'Hack Club' },
    TOTHER0: { userId: 'U222222', name: 'Other workspace' },
  },
};
const sandbox = {
  userId: 'U333333',
  teamId: 'ESANDBOX',
  updatedAt: 2,
  workspaces: { ESANDBOX: { userId: 'U333333', name: 'echolabs' } },
};

test('workspace directory survives SSB to another login without merging either session’s workspaces', () => {
  const all = [hack, sandbox];
  const directory = savedWorkspaces(all);
  assert.deepEqual(
    directory.map((row) => row.teamId),
    ['ESANDBOX', 'EHACK00', 'TOTHER0'],
  );
  assert.equal(directory.find((row) => row.teamId === 'EHACK00')!.accountId, hack.userId);
  assert.equal(directory.find((row) => row.teamId === 'TOTHER0')!.accountId, hack.userId);
  assert.deepEqual(Object.keys(sandbox.workspaces), ['ESANDBOX']);
  assert.equal(JSON.stringify(directory).includes('token'), false);
});

test('one workspace row picks the most recently used account while alternate identities stay saved', () => {
  const alt = { ...hack, userId: 'U444444', updatedAt: 3 };
  const directory = savedWorkspaces([hack, sandbox, alt]);
  assert.equal(directory.filter((row) => row.teamId === 'EHACK00').length, 1);
  assert.equal(directory.find((row) => row.teamId === 'EHACK00')!.accountId, alt.userId);
  assert.equal(hack.userId, 'U111111');
});

test('legacy saved workspaces remain navigable with their labels', () => {
  assert.deepEqual(
    savedWorkspaces([{ userId: 'U111111', teamId: 'TLEGACY', updatedAt: 1, label: 'Hack Club · U111111' }]),
    [{ accountId: 'U111111', teamId: 'TLEGACY', name: 'Hack Club', domain: undefined }],
  );
});

test('native workspace menu gains saved destinations, preserves its native rows and add-workspace action', () => {
  const active = { key: 'ESANDBOX', action: 'native' };
  const add = { key: 'team_switcher_add', action: 'add' };
  const original = [active, add];
  const directory = savedWorkspaces([hack, sandbox]);
  const make = (_source: typeof add, row: (typeof directory)[number]) => ({
    key: `${SAVED_WORKSPACE_PREFIX}${row.teamId}`,
    action: `${row.accountId}:${row.teamId}`,
  });
  const next = addSavedWorkspaceItems(original, directory, make);
  assert.equal(next[0], active);
  assert.equal(next.at(-1), add);
  assert.deepEqual(
    next.map((row) => row.action),
    ['native', 'U111111:EHACK00', 'U111111:TOTHER0', 'add'],
  );
  assert.deepEqual(original, [active, add]);
  assert.equal(addSavedWorkspaceItems(next, directory, make), next);
  const unrelated = [{ key: 'other-menu', action: 'ordinary' }];
  assert.equal(addSavedWorkspaceItems(unrelated, directory, make), unrelated);
});

test('saved workspace icons use Slack image URLs and reject unsafe or arbitrary hosts', () => {
  const iconUrl = 'https://avatars.slack-edge.com/team-icon.png';
  assert.equal(workspaceIconUrl({ image_68: iconUrl }), iconUrl);
  assert.equal(workspaceIconUrl({ image_68: 'javascript:alert(1)', image_88: iconUrl }), iconUrl);
  for (const url of [
    'file:///tmp/icon',
    'data:image/png;base64,abc',
    'https://evil.example/icon',
    'https://user:pass@avatars.slack-edge.com/icon',
  ])
    assert.equal(workspaceIconUrl({ image_68: url }), undefined);
  assert.equal(workspaceIconUrl(undefined), undefined);
  assert.equal(
    savedWorkspaces([
      { ...sandbox, workspaces: { ESANDBOX: { userId: sandbox.userId, name: 'Sandbox', iconUrl } } },
    ])[0]!.iconUrl,
    iconUrl,
  );
});
