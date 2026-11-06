'use strict';

const assert = require('node:assert/strict');
const { test } = require('node:test');
const { compareVersions } = require('./electron-watch.cjs');

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
