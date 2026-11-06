'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');

function updateCask(build, caskPath, assetsDir) {
  if (!/^[1-9][0-9]*$/.test(build) || !Number.isSafeInteger(Number(build)) || Number(build) <= 85) {
    throw new Error('Expected a v2 release build number (86 or newer)');
  }
  const source = fs.readFileSync(caskPath, 'utf8');
  const versionPattern = /^  version "2\.0\.([1-9][0-9]*)"$/m;
  const current = source.match(versionPattern);
  if (!current) throw new Error('Unexpected cask version format');
  if (Number(current[1]) > Number(build)) {
    console.log(`Skipping build ${build}: the tap already has build ${current[1]}`);
    return false;
  }

  const version = `2.0.${build}`;
  const checksum = (arch) => {
    const file = path.join(assetsDir, `Slick-${version}-mac-${arch}.zip`);
    const data = fs.readFileSync(file);
    if (data.length === 0) throw new Error(`Empty release asset: ${file}`);
    return createHash('sha256').update(data).digest('hex');
  };
  const arm = checksum('arm64');
  const intel = checksum('x64');
  const checksumPattern = /^  sha256 arm:   "[a-f0-9]{64}",\n         intel: "[a-f0-9]{64}"$/m;
  if (!checksumPattern.test(source)) throw new Error('Unexpected cask checksum format');
  const updated = source
    .replace(versionPattern, `  version "${version}"`)
    .replace(checksumPattern, `  sha256 arm:   "${arm}",\n         intel: "${intel}"`);
  if (updated === source) {
    console.log(`The tap is already up to date at ${version}`);
    return false;
  }
  fs.writeFileSync(caskPath, updated);
  console.log(`Updated the Homebrew cask to ${version}`);
  return true;
}

module.exports = { updateCask };

if (require.main === module) {
  const [build, caskPath, assetsDir] = process.argv.slice(2);
  if (!build || !caskPath || !assetsDir || process.argv.length !== 5) {
    console.error('Usage: node scripts/ci/update-homebrew.cjs BUILD CASK_PATH ASSETS_DIR');
    process.exitCode = 1;
  } else {
    try {
      updateCask(build, caskPath, assetsDir);
    } catch (error) {
      console.error(error.message);
      process.exitCode = 1;
    }
  }
}
