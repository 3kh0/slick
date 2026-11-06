'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { test } = require('node:test');
const { updateCask } = require('./update-homebrew.cjs');

function fixture(t, build = '125') {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'slick-homebrew-unit-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const cask = path.join(dir, 'slick.rb');
  fs.writeFileSync(
    cask,
    `cask "slick" do
  version "2.0.125"
  sha256 arm:   "${'a'.repeat(64)}",
         intel: "${'b'.repeat(64)}"

  app "Slick.app"
  depends_on cask: "slack"
end
`,
  );
  for (const arch of ['arm64', 'x64']) {
    fs.writeFileSync(path.join(dir, `Slick-2.0.${build}-mac-${arch}.zip`), `fixture-${arch}`);
  }
  return { dir, cask };
}

test('updates both hashes, preserves other cask fields, and is idempotent', (t) => {
  const { dir, cask } = fixture(t, '126');
  const before = fs.readFileSync(cask, 'utf8');
  assert.equal(updateCask('126', cask, dir), true);
  const after = fs.readFileSync(cask, 'utf8');
  assert.match(after, /version "2\.0\.126"/);
  for (const arch of ['arm64', 'x64']) {
    assert.ok(after.includes(createHash('sha256').update(`fixture-${arch}`).digest('hex')));
  }
  const strip = (s) => s.replace(/version "[^"]+"/, '').replace(/[a-f0-9]{64}/g, '');
  assert.equal(strip(after), strip(before));
  assert.equal(updateCask('126', cask, dir), false);
});

test('a missing architecture leaves the cask untouched', (t) => {
  const { dir, cask } = fixture(t, '126');
  const before = fs.readFileSync(cask, 'utf8');
  fs.unlinkSync(path.join(dir, 'Slick-2.0.126-mac-x64.zip'));
  assert.throws(() => updateCask('126', cask, dir), /ENOENT/);
  assert.equal(fs.readFileSync(cask, 'utf8'), before);
});

test('a delayed older release cannot downgrade the tap', (t) => {
  const { dir, cask } = fixture(t);
  const before = fs.readFileSync(cask, 'utf8');
  assert.equal(updateCask('124', cask, dir), false);
  assert.equal(fs.readFileSync(cask, 'utf8'), before);
});

test('invalid builds and unexpected cask formats fail without writing', (t) => {
  const { dir, cask } = fixture(t);
  const before = fs.readFileSync(cask, 'utf8');
  for (const build of ['85', '0125', 'v125', '126\n', '9007199254740992']) {
    assert.throws(() => updateCask(build, cask, dir), /build number/);
    assert.equal(fs.readFileSync(cask, 'utf8'), before);
  }
  fs.writeFileSync(cask, before.replace('sha256 arm:', 'sha256 broken:'));
  const malformed = fs.readFileSync(cask, 'utf8');
  assert.throws(() => updateCask('125', cask, dir), /checksum format/);
  assert.equal(fs.readFileSync(cask, 'utf8'), malformed);
});
