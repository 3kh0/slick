import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { stageAppImage, swapAppImage } from './appImageUpdate.ts';

test('AppImage update stages beside the original and replaces it atomically', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'slick-appimage-test-'));
  try {
    const current = path.join(dir, 'Slick.AppImage');
    const download = path.join(dir, 'download');
    fs.writeFileSync(current, 'old');
    fs.writeFileSync(download, 'verified new');
    const staged = stageAppImage(download, current);
    assert.equal(path.dirname(staged), dir);
    assert.equal(fs.readFileSync(current, 'utf8'), 'old');
    assert.equal(fs.statSync(staged).mode & 0o111, 0o111);
    swapAppImage(staged, current);
    assert.equal(fs.readFileSync(current, 'utf8'), 'verified new');
    assert.equal(fs.existsSync(staged), false);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
