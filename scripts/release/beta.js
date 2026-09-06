'use strict';

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

function build(root) {
  const script = path.join(root, 'scripts/early/build.js');
  if (!fs.existsSync(script)) throw new Error('This release does not include beta sources; install a newer release.');
  const result = spawnSync(process.execPath, [script], { cwd: root, stdio: 'inherit' });
  if (result.status !== 0) throw new Error('Beta build failed; beta was not enabled.');
  for (const file of ['scripts/early/desktop.js', 'dist/early-extension/desktop-preload.cjs']) {
    if (!fs.existsSync(path.join(root, file))) throw new Error(`Missing beta runtime: ${file}`);
  }
}

function configure(root, beta) {
  const marker = path.join(root, '.slick-beta');
  if (beta) {
    build(root);
    fs.writeFileSync(marker, '');
  } else {
    fs.rmSync(marker, { force: true });
  }
}

function copyPayload(root, runtime, beta = false) {
  for (const entry of [
    'scripts/early/build.js',
    'scripts/early/desktop.js',
    'scripts/byoe/early-settings.js',
    'scripts/release/beta.js',
    'runtime',
    'extension',
  ]) {
    const target = path.join(runtime, entry);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.cpSync(path.join(root, entry), target, { recursive: true });
  }
  build(runtime);
  const marker = path.join(runtime, '.slick-beta');
  if (beta) fs.writeFileSync(marker, '');
  else fs.rmSync(marker, { force: true });
}

module.exports = { build, configure, copyPayload };

if (require.main === module) {
  const [root, mode] = process.argv.slice(2);
  if (!root || !['--beta', '--stable', '--build'].includes(mode))
    throw new Error('Usage: node scripts/release/beta.js <root> --beta|--stable|--build');
  if (mode === '--build') build(path.resolve(root));
  else configure(path.resolve(root), mode === '--beta');
}
