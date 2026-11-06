import assert from 'node:assert/strict';
import test from 'node:test';
import { appPageData, listInstalledApps } from './data.ts';

test('paginates a person’s authorizations and deduplicates apps', async () => {
  const calls: Record<string, string>[] = [];
  const apps = await listInstalledApps('U123', async (params) => {
    calls.push(params);
    return params.cursor
      ? {
          apps: [
            { id: 'A123', name: 'One' },
            { id: 'A456', name: 'Two' },
          ],
        }
      : { apps: [{ id: 'A123', name: 'One' }], response_metadata: { next_cursor: 'next' } };
  });
  assert.deepEqual(
    apps.map((a) => a.id),
    ['A123', 'A456'],
  );
  assert.equal(calls[0]?.user_id, 'U123');
  assert.equal(calls[0]?.legacy_integrations, 'false');
  assert.equal(calls[1]?.cursor, 'next');
});

test('rejects repeated cursors, malformed pages, and API failures without returning partial data', async () => {
  await assert.rejects(
    listInstalledApps('U123', async () => ({ apps: [], response_metadata: { next_cursor: 'same' } })),
    /Repeated/,
  );
  await assert.rejects(
    listInstalledApps('U123', async () => ({})),
    /Invalid installed/,
  );
  await assert.rejects(
    listInstalledApps('U123', async () => {
      throw Error('denied');
    }),
    /denied/,
  );
});

test('projects only display fields and the one icon size the UI needs', async () => {
  const [app] = await listInstalledApps('U123', async () => ({
    apps: [{ id: 'A123', name: 'One', icons: { image_48: 'small', image_1024: 'large' }, unused_metadata: 'discard' }],
  }));
  assert.equal(app?.icon, 'small');
  assert.equal('icons' in app!, false);
  assert.equal('unused_metadata' in app!, false);
});

test('reads only the user IDs, names and channels from a marketplace page', () => {
  const props = (value: unknown) =>
    JSON.stringify(value).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const auth = { encodedUserLink: 'U1', userDisplayName: 'Ana & <Bo> "Cy"', fullDescription: 'x', date: 1 };
  const page = [
    '<html><body><script>var s = "<div data-automount-component=\\"AppDirectoryBotUser\\">";</script>',
    `<div class='a>b' data-automount-props="${props({ authorizations: [auth] })}" data-automount-component="AppDirectoryAuthorizations">`,
    `<div data-automount-component="AppDirectoryBotUser" data-automount-props="${props({ memberships: ['C1', 'C2'], otherGroups: 3 })}">`,
    '</div></div></body></html>',
  ].join('');
  assert.deepEqual(appPageData(page), {
    authorizations: [{ userId: 'U1', name: 'Ana & <Bo> "Cy"' }],
    memberships: ['C1', 'C2'],
    otherGroups: 3,
  });
  assert.deepEqual(
    appPageData(
      '<div data-automount-component="AppDirectoryBotUser" data-automount-props="{&#34;memberships&#34;:[&#x22;C9&#x22;]}">',
    ),
    {
      authorizations: [],
      memberships: ['C9'],
      otherGroups: 0,
    },
  );
  assert.throws(() => appPageData('<html><body>Sign in to Slack</body></html>'), /requires sign-in/);
  assert.throws(
    () => appPageData('<div data-automount-component="AppDirectoryBotUser" data-automount-props="{">'),
    /requires sign-in/,
  );
});
