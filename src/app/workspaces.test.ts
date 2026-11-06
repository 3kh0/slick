import assert from 'node:assert/strict';
import { test, type TestContext } from 'node:test';
import { currentWorkspaceId, knownWorkspaces, watchWorkspace } from './workspaces.ts';

function setGlobal(t: TestContext, name: string, value: unknown) {
  const previous = Object.getOwnPropertyDescriptor(globalThis, name);
  Object.defineProperty(globalThis, name, { value, configurable: true, writable: true });
  t.after(() => {
    if (previous) Object.defineProperty(globalThis, name, previous);
    else Reflect.deleteProperty(globalThis, name);
  });
}

test('workspace discovery retains saved IDs without using another window’s active workspace', (t) => {
  setGlobal(t, 'location', { pathname: '/client/T1/C1' });
  setGlobal(t, 'localStorage', {
    getItem: () =>
      JSON.stringify({
        lastActiveTeamId: 'T2',
        teams: { T1: { name: 'One' }, T2: { name: 'Two' }, invalid: { name: 'Invalid' } },
      }),
  });
  assert.equal(currentWorkspaceId(), 'T1');
  assert.deepEqual(knownWorkspaces(['T3']), [
    { id: 'T1', name: 'One' },
    { id: 'T3', name: 'T3' },
    { id: 'T2', name: 'Two' },
  ]);
  (globalThis as any).location.pathname = '/client';
  assert.equal(currentWorkspaceId(), null);
});

test('history changes notify synchronously only when the workspace changes and disposal restores history', (t) => {
  const location = { pathname: '/client/T1/C1' };
  setGlobal(t, 'location', location);
  const events = new EventTarget();
  const pushState = (_data: unknown, _unused: string, url?: string | URL | null) => {
    location.pathname = String(url);
  };
  const history = { pushState, replaceState: pushState };
  setGlobal(t, 'window', Object.assign(events, { history }));
  let changes = 0;
  const stop = watchWorkspace(() => changes++);
  try {
    history.pushState(null, '', '/client/T1/C2');
    assert.equal(changes, 0);
    history.replaceState(null, '', '/client/T2/C2');
    assert.equal(changes, 1);
    location.pathname = '/client/T3';
    events.dispatchEvent(new Event('popstate'));
    assert.equal(changes, 2);
  } finally {
    stop();
  }
  assert.equal(history.pushState, pushState);
  history.pushState(null, '', '/client/T4');
  assert.equal(changes, 2);
});
