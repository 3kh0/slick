import assert from 'node:assert/strict';
import { test } from 'node:test';
import { restrictedAccess, restrictionKey, type RestrictedChannel } from './access.ts';

const allowed = { readOnly: false, threadOnly: false };
const posting: RestrictedChannel = { properties: { posting_restricted_to: { type: ['admin'] } } };

test('admin-only posting warns while unrestricted replies remain available', () => {
  assert.deepEqual(restrictedAccess(posting, 'UADMIN', allowed), { readOnly: false, threadOnly: true });
  const all = { properties: { ...posting.properties, threads_restricted_to: { type: ['org_admin'] } } };
  assert.deepEqual(restrictedAccess(all, 'UADMIN', allowed), { readOnly: true, threadOnly: false });
});

test('ordinary restrictions, explicitly allowed users and public channels are left alone', () => {
  assert.equal(restrictedAccess(posting, 'UADMIN', { readOnly: true, threadOnly: false }), null);
  assert.equal(restrictedAccess(posting, 'UADMIN', { readOnly: false, threadOnly: true }), null);
  assert.equal(restrictedAccess({ properties: {} }, 'UADMIN', allowed), null);
  assert.equal(restrictedAccess(undefined, 'UADMIN', allowed), null);
  assert.equal(restrictedAccess(posting, undefined, allowed), null);
  assert.equal(
    restrictedAccess(
      { properties: { posting_restricted_to: { type: ['admin'], user: ['UADMIN'] } } },
      'UADMIN',
      allowed,
    ),
    null,
  );
  assert.equal(
    restrictedAccess({ properties: { posting_restricted_to: { type: ['admin', 'member'] } } }, 'UADMIN', allowed),
    null,
  );
});

test('Post anyway expires after policy or account changes', () => {
  const ignored = restrictionKey(posting, 'UADMIN');
  assert.equal(restrictedAccess(posting, 'UADMIN', allowed, ignored), null);
  assert.ok(restrictedAccess(posting, 'UOTHER', allowed, ignored));
  const changed = { properties: { posting_restricted_to: { type: ['admin', 'org_admin'] } } };
  assert.ok(restrictedAccess(changed, 'UADMIN', allowed, ignored));
});
