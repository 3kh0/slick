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

test('default empty nicknames retain menus without registering an identity members patch', () => {
  const f = fixture();
  f.plugin.start();
  assert.equal(Nicknames.defaultEnabled, true);
  assert.deepEqual(f.components, [
    'RimetoMemberProfileOverflowMenu',
    'AppDetailsOverflow',
    'MenuFromTemplate',
    'EditProfileFormPane',
  ]);
  assert.equal(f.patches.length, 0);
  f.plugin.onSettingsChange(['names']);
  f.plugin.stop();
  assert.deepEqual(f.counts(), { refreshes: 0, disposals: 0 });
});

test('live add, edit, remove and re-add manage one member patch and invalidate active mappings', () => {
  const f = fixture();
  const member = { profile: { display_name: 'Original' } };
  f.plugin.start();
  f.config.names = { U123456: 'First' };
  f.plugin.onSettingsChange(['names']);
  assert.equal(f.patches.length, 1);
  assert.equal(f.patches[0].map('U123456', member).profile.display_name, 'First');
  assert.equal(f.patches[0].map('U999999', member), member);
  const withoutProfile = {};
  assert.equal(f.patches[0].map('U123456', withoutProfile), withoutProfile);
  assert.equal(member.profile.display_name, 'Original');
  assert.deepEqual(f.counts(), { refreshes: 0, disposals: 0 });

  f.config.names = { U123456: 'Second' };
  f.plugin.onSettingsChange(['names']);
  assert.equal(f.patches.length, 1);
  assert.equal(f.patches[0].map('U123456', member).profile.display_name, 'Second');
  assert.deepEqual(f.counts(), { refreshes: 1, disposals: 0 });

  f.config.names = {};
  f.plugin.onSettingsChange(['names']);
  assert.equal(f.patches[0].active, false);
  f.plugin.onSettingsChange(['names']);
  assert.deepEqual(f.counts(), { refreshes: 1, disposals: 1 });

  f.config.names = { U123456: 'Again' };
  f.plugin.onSettingsChange(['names']);
  assert.equal(f.patches.length, 2);
  assert.equal(f.patches[1].map('U123456', member).profile.display_name, 'Again');
  f.plugin.stop();
  f.plugin.stop();
  assert.deepEqual(f.counts(), { refreshes: 1, disposals: 2 });
});

test('effective nicknames use the existing truthiness rule and can be present at startup', () => {
  const f = fixture({ U123456: '' });
  f.plugin.start();
  assert.equal(f.patches.length, 0);
  f.config.names = { U123456: ' ' };
  f.plugin.onSettingsChange(['names']);
  assert.equal(f.patches.length, 1);
  f.plugin.stop();

  const populated = fixture({ U123456: 'Nickname' });
  populated.plugin.start();
  assert.equal(populated.patches.length, 1);
  populated.plugin.onSettingsChange(['names']);
  assert.deepEqual(populated.counts(), { refreshes: 1, disposals: 0 });
  populated.plugin.stop();
});

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

test('app nicknames rename every bot of the app and its bot user', () => {
  const f = fixture({ U123456: 'Pal' });
  f.plugin.start();
  assert.equal(f.slice('bots').length, 0);

  f.config.names = { U123456: 'Pal', A0APP0001: 'Robo' };
  f.plugin.onSettingsChange(['names']);
  const [bots] = f.slice('bots');
  const [members] = f.slice('members');
  const bot = { name: 'Scanner', app_id: 'A0APP0001' };
  assert.equal(bots.map('B0BOT0001', bot).name, 'Robo');
  assert.equal(bot.name, 'Scanner');
  const stranger = { name: 'Other', app_id: 'A0APP0002' };
  assert.equal(bots.map('B0BOT0002', stranger), stranger);

  const botUser = { is_bot: true, profile: { api_app_id: 'A0APP0001', real_name: 'Scanner' } };
  assert.equal(members.map('U0BOT0001', botUser).profile.real_name, 'Robo');
  const human = { profile: { api_app_id: 'A0APP0001', real_name: 'Human' } };
  assert.equal(members.map('U0HUMAN01', human), human);

  f.config.names = { U123456: 'Pal' };
  f.plugin.onSettingsChange(['names']);
  assert.equal(bots.active, false);
  assert.equal(members.active, true);
  f.plugin.stop();
});
