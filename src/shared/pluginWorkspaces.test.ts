import assert from 'node:assert/strict';
import { test } from 'node:test';
import { appWideReason, workspaceAllowed, workspaceFromPath, workspaceSelection } from './pluginWorkspaces.ts';

test('legacy settings run everywhere; restricted settings fail closed with no workspace', () => {
  assert.equal(workspaceAllowed(undefined, null), true);
  assert.equal(workspaceAllowed(null, 'T2'), true);
  assert.equal(workspaceAllowed(['T1'], 'T1'), true);
  assert.equal(workspaceAllowed(['T1'], 'T2'), false);
  assert.equal(workspaceAllowed(['T1'], null), false);
  for (const invalid of [[], 'T1', {}, false, ['bad', 42]]) assert.equal(workspaceAllowed(invalid, 'T1'), false);
  assert.deepEqual(workspaceSelection(['T1', 'T1', 'E2', null, 'T3/other']), ['T1', 'E2']);
});

test('workspace identity is exact, window-local and supports enterprise routes', () => {
  assert.equal(workspaceFromPath('/client/T123/C123'), 'T123');
  assert.equal(workspaceFromPath('/client/E123'), 'E123');
  for (const path of ['/client', '/client/', '/client/T1%2FC1', '/client/T1suffix', '/other/T123']) {
    assert.equal(workspaceFromPath(path), null);
  }
  assert.equal(workspaceAllowed(['T123'], 'T1234'), false);
  assert.equal(appWideReason('HaikuWarning'), undefined);
  assert.ok(appWideReason('Snappy'));
  assert.equal(appWideReason('constructor'), undefined);
});
