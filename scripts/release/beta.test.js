'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { spawnSync } = require('node:child_process');
const { build, configure, copyPayload } = require('./beta');
const ROOT = path.resolve(__dirname, '../..');

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'slick-beta-test-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return root;
}

test('release payload builds independently and remains stable until explicitly enabled', (t) => {
  const runtime = fixture(t);
  fs.cpSync(path.join(ROOT, 'plugins'), path.join(runtime, 'plugins'), { recursive: true });
  copyPayload(ROOT, runtime);
  const marker = path.join(runtime, '.slick-beta');
  assert.equal(fs.existsSync(marker), false);
  assert.ok(fs.existsSync(path.join(runtime, 'dist/early-extension/desktop-preload.cjs')));
  fs.rmSync(path.join(runtime, 'dist'), { recursive: true });
  configure(runtime, true);
  assert.ok(fs.existsSync(marker));
  assert.ok(fs.existsSync(path.join(runtime, 'dist/early-extension/desktop-preload.cjs')));
  configure(runtime, false);
  assert.equal(fs.existsSync(marker), false);
  configure(runtime, false);
});

test('source preflight builds without enabling beta and explicit packaging enables it', (t) => {
  const runtime = fixture(t);
  fs.cpSync(path.join(ROOT, 'plugins'), path.join(runtime, 'plugins'), { recursive: true });
  copyPayload(ROOT, runtime);
  build(runtime);
  assert.equal(fs.existsSync(path.join(runtime, '.slick-beta')), false);
  copyPayload(ROOT, runtime, true);
  assert.ok(fs.existsSync(path.join(runtime, '.slick-beta')));
  copyPayload(ROOT, runtime, false);
  assert.equal(fs.existsSync(path.join(runtime, '.slick-beta')), false);
});

test('Linux release beta failure preserves the installed app', (t) => {
  const root = fixture(t);
  const bin = path.join(root, 'bin');
  const home = path.join(root, 'home');
  const installed = path.join(home, '.local/share/slick/app');
  const slack = path.join(root, 'slack');
  fs.mkdirSync(bin);
  fs.mkdirSync(installed, { recursive: true });
  fs.mkdirSync(path.join(slack, 'resources'), { recursive: true });
  fs.writeFileSync(path.join(slack, 'resources/app.asar'), '');
  fs.writeFileSync(path.join(installed, 'sentinel'), 'old install');
  fs.copyFileSync(path.join(ROOT, 'install-linux.sh'), path.join(root, 'install-linux.sh'));
  const stub = (name, source) => fs.writeFileSync(path.join(bin, name), '#!/bin/bash\n' + source, { mode: 0o755 });
  stub('uname', 'if [ "$1" = "-s" ]; then echo Linux; else echo x86_64; fi\n');
  stub('gh', 'exit 0\n');
  stub('curl', 'echo \'{"tag_name":"v1","url":"https://example.invalid/test-linux-x64.tar.gz"}\'\n');
  stub(
    'tar',
    `dest="$4/Slick"\nmkdir -p "$dest/resources/slick/scripts/release"\nprintf '#!/bin/bash\\nexit 1\\n' > "$dest/electron"\nchmod +x "$dest/electron"\nif [ "$FAIL_BUILD" = 1 ]; then touch "$dest/resources/slick/scripts/release/beta.js"; fi\n`,
  );
  for (const failBuild of ['0', '1']) {
    const result = spawnSync('bash', [path.join(root, 'install-linux.sh'), '--beta', '--no-launch'], {
      encoding: 'utf8',
      env: {
        ...process.env,
        PATH: `${bin}:${process.env.PATH}`,
        HOME: home,
        XDG_DATA_HOME: path.join(home, '.local/share'),
        SLICK_SLACK_DIR: slack,
        FAIL_BUILD: failBuild,
      },
    });
    assert.notEqual(result.status, 0, result.stdout + result.stderr);
    if (failBuild === '0') assert.match(result.stderr, /does not support --beta/);
    else assert.match(result.stdout, /Building and enabling staged beta runtime/);
    assert.equal(fs.readFileSync(path.join(installed, 'sentinel'), 'utf8'), 'old install');
  }
});

test('missing or failing beta builds never enable a stable installation', (t) => {
  const root = fixture(t);
  assert.throws(() => configure(root, true), /does not include beta sources/);
  fs.mkdirSync(path.join(root, 'scripts/early'), { recursive: true });
  fs.writeFileSync(path.join(root, 'scripts/early/build.js'), 'process.exit(1);');
  assert.throws(() => configure(root, true), /Beta build failed/);
  assert.equal(fs.existsSync(path.join(root, '.slick-beta')), false);
});

test('every launcher builder packages beta sources without copying the opt-in marker', () => {
  for (const name of ['build-handoff-app.js', 'build-handoff-app-win.js', 'build-handoff-linux.js']) {
    const source = fs.readFileSync(path.join(ROOT, 'scripts/byoe', name), 'utf8');
    assert.match(source, /require\('\.\.\/release\/beta'\)\.copyPayload\(ROOT, runtime, beta\)/);
  }
});
