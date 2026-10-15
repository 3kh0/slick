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

function fixture(names: Record<string, string> = {}) {
  const previousReact = (globalThis as any).React;
  (globalThis as any).React = { createContext: () => ({}) };
  const config = { names };
  const components: string[] = [];
  const patches: { map: (id: string, member: any) => any; active: boolean }[] = [];
  let refreshes = 0;
  let disposals = 0;
  try {
    const plugin = new Nicknames(
      {
        redux: {
          patchSlice(slice: string, map: (id: string, member: any) => any) {
            assert.equal(slice, 'members');
            const patch = { map, active: true };
            patches.push(patch);
            return () => {
              if (!patch.active) return;
              patch.active = false;
              disposals++;
            };
          },
          refresh() {
            refreshes++;
          },
        },
        patchComponent(name: string) {
          components.push(name);
        },
        members: {
          modifyMemberObject(member: any, change: { name: string }) {
            return { ...member, profile: { ...member.profile, display_name: change.name } };
          },
        },
      },
      config,
    );
    return { plugin, config, components, patches, counts: () => ({ refreshes, disposals }) };
  } finally {
    (globalThis as any).React = previousReact;
  }
}

test('default empty nicknames retain menus without registering an identity members patch', () => {
  const f = fixture();
  f.plugin.start();
  assert.equal(Nicknames.defaultEnabled, true);
  assert.deepEqual(f.components, ['RimetoMemberProfileOverflowMenu', 'MenuFromTemplate']);
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
