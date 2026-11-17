'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

function updateFlatpakElectron(manifest, version, checksums) {
  if (!/^\d+\.\d+\.\d+$/.test(version)) throw new Error(`invalid Electron version: ${version}`);
  const hashes = new Map(
    checksums.split(/\r?\n/).flatMap((line) => {
      const match = /^([a-f0-9]{64})\s+\*?(\S+)$/.exec(line);
      return match ? [[match[2], match[1]]] : [];
    }),
  );
  const seen = new Set();
  const updated = manifest.replace(
    /url: https:\/\/github\.com\/electron\/electron\/releases\/download\/v[^/\s]+\/electron-v[^/\s]+-linux-(x64|arm64)\.zip\r?\n([ \t]*)sha256: [a-f0-9]+/g,
    (_, arch, indent) => {
      const name = `electron-v${version}-linux-${arch}.zip`;
      const hash = hashes.get(name);
      if (!hash) throw new Error(`missing checksum for ${name}`);
      if (seen.has(arch)) throw new Error(`duplicate Flatpak Electron archive for ${arch}`);
      seen.add(arch);
      return `url: https://github.com/electron/electron/releases/download/v${version}/${name}\n${indent}sha256: ${hash}`;
    },
  );
  if (seen.size !== 2) throw new Error('expected both Flatpak Electron architectures');
  return updated;
}

async function main() {
  const version = process.argv[2];
  if (!/^\d+\.\d+\.\d+$/.test(version || '')) throw new Error('usage: update-electron.cjs <version>');
  const response = await fetch(`https://github.com/electron/electron/releases/download/v${version}/SHASUMS256.txt`, {
    signal: AbortSignal.timeout(60000),
  });
  if (!response.ok) throw new Error(`Electron checksums: HTTP ${response.status}`);
  const root = path.join(__dirname, '..', '..');
  const file = path.join(root, 'packaging', 'flatpak', 'dev.slick.Slick.yml');
  const manifest = updateFlatpakElectron(fs.readFileSync(file, 'utf8'), version, await response.text());
  execFileSync('bun', ['add', '--dev', '--exact', `electron@${version}`], { cwd: root, stdio: 'inherit' });
  fs.writeFileSync(file, manifest);
}

module.exports = { updateFlatpakElectron };
if (require.main === module) {
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
