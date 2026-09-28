import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { syncLinuxIcons } from './iconRefresh.ts';

function tmp(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'slick-icons-'));
}

test('syncLinuxIcons replaces only the sizes install-linux.sh installed', () => {
  const bundled = tmp();
  const hicolor = tmp();
  for (const size of [16, 256, 1024]) fs.writeFileSync(path.join(bundled, `${size}.png`), `new-${size}`);
  fs.writeFileSync(path.join(bundled, 'README'), 'ignored');
  for (const size of [16, 256]) {
    fs.mkdirSync(path.join(hicolor, `${size}x${size}`, 'apps'), { recursive: true });
    fs.writeFileSync(path.join(hicolor, `${size}x${size}`, 'apps', 'slick.png'), 'old');
  }

  assert.equal(syncLinuxIcons(bundled, hicolor), 2);
  assert.equal(fs.readFileSync(path.join(hicolor, '16x16', 'apps', 'slick.png'), 'utf8'), 'new-16');
  assert.equal(fs.readFileSync(path.join(hicolor, '256x256', 'apps', 'slick.png'), 'utf8'), 'new-256');
  assert.equal(fs.existsSync(path.join(hicolor, '1024x1024')), false);
});

test('syncLinuxIcons is a no-op without bundled icons or an install', () => {
  assert.equal(syncLinuxIcons(path.join(tmp(), 'missing'), tmp()), 0);
  const bundled = tmp();
  fs.writeFileSync(path.join(bundled, '64.png'), 'x');
  assert.equal(syncLinuxIcons(bundled, tmp()), 0);
});
