import assert from 'node:assert/strict';
import { test } from 'node:test';
import { build } from 'esbuild';

const bundle = await build({
  entryPoints: [new URL('./index.tsx', import.meta.url).pathname],
  bundle: true,
  write: false,
  platform: 'node',
  format: 'esm',
});
const { default: Nicknames } = await import(
  `data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0]!.text).toString('base64')}`
);

const SELF = 'U0SELF001';

type SlicePatch = { slice: string; map: (id: string, value: any) => any; active: boolean };

function fixture(names: Record<string, string> = {}, rawMembers: Record<string, any> = {}) {
  const previousReact = (globalThis as any).React;
  (globalThis as any).React = { createContext: () => ({}) };
  const config = { names };
  const components: string[] = [];
  const thunks = new Map<string, (original: (...args: any[]) => any) => (...args: any[]) => any>();
  const patches: SlicePatch[] = [];
  let refreshes = 0;
  let disposals = 0;
  try {
    const plugin = new Nicknames(
      {
        redux: {
          patchSlice(slice: string, map: (id: string, value: any) => any) {
            const patch = { slice, map, active: true };
            patches.push(patch);
            return () => {
              if (!patch.active) return;
              patch.active = false;
              disposals++;
            };
          },
          patchThunk(name: string, wrap: (original: (...args: any[]) => any) => (...args: any[]) => any) {
            thunks.set(name, wrap);
          },
          getRawState: () => ({ members: rawMembers }),
          refresh() {
            refreshes++;
          },
        },
        patchComponent(name: string) {
          components.push(name);
        },
        members: {
          getCurrentMemberId: () => SELF,
          modifyMemberObject(member: any, change: { name: string }) {
            return {
              ...member,
              profile: { ...member.profile, display_name: change.name, real_name: change.name },
            };
          },
        },
      },
      config,
    );
    const slice = (name: string) => patches.filter((patch) => patch.slice === name);
    const thunk = (name: string) => thunks.get(name)!((...args: any[]) => args);
    return { plugin, config, components, patches, slice, thunk, counts: () => ({ refreshes, disposals }) };
  } finally {
    (globalThis as any).React = previousReact;
  }
}

test('profile writes built from a nicknamed copy keep the real names', () => {
  const real = { profile: { real_name: 'Real Name', display_name: 'real', pronouns: 'they/them' } };
  const f = fixture({ [SELF]: 'Nick', U0OTHER01: 'Pal' }, { [SELF]: real, U0OTHER01: real });
  f.plugin.start();
  const apiCall = f.thunk('apiCall');
  const send = (request: object) => apiCall(request)[0];

  const leaked = { real_name: 'Nick', display_name: 'Nick', pronouns: 'she/her' };
  const sent = send({ method: 'users.profile.set', args: { profile: JSON.stringify(leaked) } });
  assert.deepEqual(JSON.parse(sent.args.profile), {
    real_name: 'Real Name',
    display_name: 'real',
    pronouns: 'she/her',
  });

  const edited = { method: 'users.profile.set', args: { profile: { real_name: 'New Name', display_name: 'Nick' } } };
  assert.deepEqual(send(edited).args.profile, { real_name: 'New Name', display_name: 'real' });

  const field = send({ method: 'users.profile.set', args: { name: 'display_name', value: 'Nick' } });
  assert.equal(field.args.value, 'real');

  const other = send({ method: 'users.profile.set', args: { user: 'U0OTHER01', profile: '{"real_name":"Pal"}' } });
  assert.equal(JSON.parse(other.args.profile).real_name, 'Real Name');

  const untouched = { method: 'users.profile.set', args: { profile: '{"status_text":"Nick"}' } };
  assert.equal(send(untouched), untouched);
  const otherMethod = { method: 'chat.postMessage', args: { text: 'Nick' } };
  assert.equal(send(otherMethod), otherMethod);
  f.plugin.stop();
});

test('the profile editor sees and saves your real name while it is open', () => {
  const f = fixture({ [SELF]: 'Nick' }, { [SELF]: { profile: { real_name: 'Real Name' } } });
  f.plugin.start();
  const [members] = f.slice('members');
  const self = { profile: { real_name: 'Real Name', display_name: '' } };
  assert.equal(members.map(SELF, self).profile.real_name, 'Nick');

  f.thunk('openEditProfileModal')();
  assert.equal(members.map(SELF, self), self);
  assert.deepEqual(f.counts(), { refreshes: 1, disposals: 0 });

  const typed = { method: 'users.profile.set', args: { profile: '{"real_name":"Nick"}' } };
  assert.equal(f.thunk('apiCall')(typed)[0], typed);
  f.plugin.stop();
  assert.equal(members.active, false);
});
