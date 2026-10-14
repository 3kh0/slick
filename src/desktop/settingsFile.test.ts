import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readStoredSettings } from './settingsFile.ts';

test('resolves the supplied settings snapshot without reading the profile again', () => {
  assert.deepEqual(readStoredSettings('{"enabled":false,"plugins":{"NoTrack":{"enabled":false}}}'), {
    enabled: false,
    plugins: { NoTrack: { enabled: false } },
  });
  assert.deepEqual(readStoredSettings('{"enabled":true,"plugins":[]}'), { enabled: undefined, plugins: undefined });
  for (const invalid of ['null', '[]', 'false', '"text"']) assert.equal(readStoredSettings(invalid), null);
});
