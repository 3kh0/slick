import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { readBootSettings, readStoredSettings } from './settingsFile.ts';

test('boot reads preserve saved text and distinguish a missing file from unreadable preferences', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'slick-boot-settings-'));
  const file = path.join(dir, 'settings.json');
  try {
    assert.equal(readBootSettings(file), '{}', 'a first launch may use defaults');
    for (const text of ['{"enabled":false,"plugins":{"Snappy":{"enabled":false}}}', '{broken', 'null', '']) {
      await writeFile(file, text, 'utf8');
      assert.equal(readBootSettings(file), text, 'the boot policy must see the exact saved preferences');
    }
    assert.equal(readBootSettings(dir), undefined, 'a directory cannot become enabled defaults');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('boot reads fail closed on permission and I/O failures', () => {
  // Inject these errors because chmod-based EACCES tests depend on the test
  // user's privileges, and an actual I/O failure is not portable to induce.
  for (const code of ['EACCES', 'EIO']) {
    assert.equal(
      readBootSettings('/unused/settings.json', () => {
        throw Object.assign(new Error('Cannot read saved preferences'), { code });
      }),
      undefined,
    );
  }
});

test('resolves the supplied settings snapshot without reading the profile again', () => {
  assert.deepEqual(readStoredSettings('{"enabled":false,"plugins":{"NoTrack":{"enabled":false}}}'), {
    enabled: false,
    plugins: { NoTrack: { enabled: false } },
  });
  assert.deepEqual(readStoredSettings('{"enabled":true,"plugins":[]}'), { enabled: undefined, plugins: undefined });
  for (const invalid of ['null', '[]', 'false', '"text"']) assert.equal(readStoredSettings(invalid), null);
});
