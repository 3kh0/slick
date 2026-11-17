'use strict';

const assert = require('node:assert/strict');
const { test } = require('node:test');
const { compareVersions } = require('./electron-watch.cjs');
const { updateFlatpakElectron } = require('./update-electron.cjs');

test('matching runtimes need no alert', () => {
  assert.deepEqual(compareVersions('44.4.5', '44.4.5'), { mismatch: false, versionMismatch: false });
});

test('minor and patch differences alert without rejecting native-module compatibility', () => {
  for (const pin of ['44.2.0', '44.4.4', '44.4.6']) {
    assert.deepEqual(compareVersions('44.4.5', pin), { mismatch: false, versionMismatch: true });
  }
});

test('major differences also fail the release compatibility gate', () => {
  assert.deepEqual(compareVersions('44.4.5', '43.1.1'), { mismatch: true, versionMismatch: true });
});

test('invalid versions cannot silently pass the comparison', () => {
  for (const version of ['', 'unknown', '44', '44.4.5\n']) {
    assert.throws(() => compareVersions(version, '44.4.5'), /invalid Electron version/);
    assert.throws(() => compareVersions('44.4.5', version), /invalid Electron version/);
  }
});

const manifest = ['x64', 'arm64']
  .map(
    (arch) =>
      `url: https://github.com/electron/electron/releases/download/v44.0.0/electron-v44.0.0-linux-${arch}.zip\n  sha256: ${'0'.repeat(64)}`,
  )
  .join('\n');
const checksums = `${'a'.repeat(64)} *electron-v45.3.2-linux-x64.zip\n${'b'.repeat(64)}  electron-v45.3.2-linux-arm64.zip\n`;

test('updates both Flatpak archives with their own published checksums', () => {
  const updated = updateFlatpakElectron(manifest, '45.3.2', checksums);
  assert.match(updated, /v45\.3\.2\/electron-v45\.3\.2-linux-x64\.zip\n  sha256: a{64}/);
  assert.match(updated, /v45\.3\.2\/electron-v45\.3\.2-linux-arm64\.zip\n  sha256: b{64}/);
  assert.equal(updateFlatpakElectron(updated, '45.3.2', checksums), updated);
});

test('incomplete runtime updates fail instead of leaving a mixed Flatpak manifest', () => {
  assert.throws(() => updateFlatpakElectron(manifest, '45.3.2', checksums.split('\n')[0]), /missing checksum/);
  assert.throws(() => updateFlatpakElectron(manifest, '45.3.2', checksums.replace(/a/g, 'z')), /missing checksum/);
  assert.throws(() => updateFlatpakElectron('', '45.3.2', checksums), /both Flatpak/);
  assert.throws(() => updateFlatpakElectron(manifest + '\n' + manifest, '45.3.2', checksums), /duplicate/);
  assert.throws(() => updateFlatpakElectron(manifest, 'latest', checksums), /invalid Electron version/);
});
