// Packages the staged loader into distributable artifacts with
// electron-builder, replacing the three hand-rolled builders in scripts/byoe/
// (build-handoff-app.js, -app-win.js, -linux.js -- about 1,270 lines that had
// to be kept in step with each other by hand, which is most of what
// scripts/ci/validate.js existed to police).
//
// Two constraints are inherited rather than chosen, and both matter:
//
//   * The artifact names are a contract. install.sh, install.ps1,
//     install-linux.sh and the updater's `pickAsset` all match on
//     `-mac-<arch>.zip`, `-win32-<arch>.zip` and `-linux-<arch>.tar.gz`.
//     Renaming the artifacts would silently break updates for everyone
//     already on v1, so electron-builder is configured to produce the names
//     that already exist rather than the installers being reworked around
//     electron-builder's defaults.
//
//   * The macOS bundle id is `dev.slick.byoe.handoff`. That is what install.sh
//     registers as the `slack://` handler, and what an existing install has
//     recorded in LaunchServices.
//
// Slick is BYOE: its Electron `require`s Slack's app.asar at runtime. Nothing
// about that changes here -- this packages Slick's own Electron and loader,
// exactly as the dev stage runs them.

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { build as electronBuild, Platform } from 'electron-builder';
import { ASSETS, DIST, DIST_DESKTOP, ROOT, THEMES } from '../lib/paths.ts';
import { versions } from '../lib/versions.ts';
import { buildDesktop } from './desktop.ts';

/** The Electron major must track Slack's; .github/workflows/electron-watch.yml enforces it. */
function electronVersion(): string {
  const manifest = JSON.parse(readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
  const declared = manifest.devDependencies?.electron;
  const version = String(declared ?? '').replace(/^[^\d]*/, '');
  if (!version) throw new Error('[build:package] no electron version in devDependencies');
  return version;
}

const OUTPUT = path.join(DIST, 'release');

export async function packageDesktop({ debug = false, platform = process.platform } = {}) {
  await buildDesktop({ debug });

  const targets =
    platform === 'darwin'
      ? Platform.MAC.createTarget()
      : platform === 'win32'
        ? Platform.WINDOWS.createTarget()
        : Platform.LINUX.createTarget();

  const results = await electronBuild({
    targets,
    config: {
      appId: 'dev.slick.byoe.handoff',
      productName: 'Slick',
      copyright: 'Slick contributors',
      electronVersion: electronVersion(),

      directories: { app: DIST_DESKTOP, output: OUTPUT, buildResources: ASSETS },
      // The staged app is already bundled; nothing else belongs in the asar.
      files: ['**/*'],
      asar: true,

      extraResources: [
        // Served over slick:// from Slick's own resources. main.ts captures
        // `process.resourcesPath` before patch.ts spoofs it to Slack's.
        { from: path.join(DIST_DESKTOP, 'slick.js'), to: 'slick.js' },
        { from: path.join(DIST_DESKTOP, 'monaco'), to: 'monaco' },
        { from: THEMES, to: 'themes', filter: ['**/*.json'] },
      ],

      protocols: [{ name: 'Slack URL', schemes: ['slack'] }],

      mac: {
        category: 'public.app-category.productivity',
        icon: path.join(ASSETS, 'desktop.icns'),
        target: [{ target: 'zip', arch: ['arm64', 'x64'] }],
        artifactName: 'Slick-${version}-mac-${arch}.${ext}',
        // Slick is distributed through an installer that verifies a GitHub
        // build attestation, not through notarization.
        identity: null,
      },

      win: {
        icon: path.join(ASSETS, 'icon.ico'),
        target: [{ target: 'zip', arch: ['x64', 'arm64'] }],
        artifactName: 'Slick-${version}-win32-${arch}.${ext}',
      },

      linux: {
        // Pinned rather than derived from productName, because install-linux.sh
        // and the .desktop file's Exec line both name it.
        executableName: 'slick',
        category: 'Network;InstantMessaging',
        icon: path.join(ASSETS, 'icon.png'),
        target: [{ target: 'tar.gz', arch: ['x64', 'arm64'] }],
        artifactName: 'Slick-${version}-linux-${arch}.${ext}',
      },

      // Nothing here is published from the build; release.yml uploads and
      // attests the artifacts itself.
      publish: null,
    },
  });

  for (const artifact of results) console.log(`[build:package] ${path.relative(ROOT, artifact)}`);
  console.log(`[build:package] version ${versions.version} (build ${versions.build})`);
  return results;
}
