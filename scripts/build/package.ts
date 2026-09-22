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
import { copyFile, cp, mkdir, rename, rm } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import { Arch, archFromString, build as electronBuild, Platform } from 'electron-builder';
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
const { archive } = createRequire(import.meta.url)('app-builder-lib/out/targets/archive.js') as {
  archive(format: string, outFile: string, dirToArchive: string): Promise<string>;
};

type PackageOptions = { debug?: boolean; platform?: NodeJS.Platform; arch?: string };

function targetArch(value?: string): Arch {
  const chosen = value ?? process.arch;
  if (chosen !== 'x64' && chosen !== 'arm64') throw new Error(`[build:package] unsupported architecture: ${chosen}`);
  return archFromString(chosen);
}

async function legacyArchive(platform: NodeJS.Platform, arch: string): Promise<string> {
  const unpacked =
    platform === 'win32'
      ? arch === 'arm64'
        ? 'win-arm64-unpacked'
        : 'win-unpacked'
      : arch === 'arm64'
        ? 'linux-arm64-unpacked'
        : 'linux-unpacked';
  const built = path.join(OUTPUT, unpacked);
  const stage = path.join(OUTPUT, `.archive-${platform}-${arch}`);
  const app = path.join(stage, 'Slick');

  await rm(stage, { recursive: true, force: true });
  await mkdir(stage, { recursive: true });
  await cp(built, app, { recursive: true, verbatimSymlinks: true });

  if (platform === 'linux') {
    // v1's installed launcher and updater invoke Slick/electron after replacing
    // the app. Keep that entry point for the one-way migration to v2.
    await copyFile(path.join(app, 'slick'), path.join(app, 'electron'));
  }

  const suffix = platform === 'win32' ? `win32-${arch}.zip` : `linux-${arch}.tar.gz`;
  const artifact = path.join(OUTPUT, `Slick-${versions.version}-${suffix}`);
  if (platform === 'win32') {
    await archive('zip', artifact, app);
  } else {
    const temporaryArtifact = path.join(stage, 'Slick.tar.gz');
    await rm(artifact, { force: true });
    await archive('tar.gz', temporaryArtifact, app);
    await rename(temporaryArtifact, artifact);
  }
  await rm(stage, { recursive: true, force: true });
  return artifact;
}

export async function packageDesktop({ debug = false, platform = process.platform, arch }: PackageOptions = {}) {
  await buildDesktop({ debug });

  const selectedArch = targetArch(arch);
  const selectedPlatform =
    platform === 'darwin' ? Platform.MAC : platform === 'win32' ? Platform.WINDOWS : Platform.LINUX;
  const targets = selectedPlatform.createTarget(platform === 'darwin' ? ['zip', 'dmg'] : 'dir', selectedArch);

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

  if (platform !== 'darwin') results.push(await legacyArchive(platform, Arch[selectedArch]));
  for (const artifact of results) console.log(`[build:package] ${path.relative(ROOT, artifact)}`);
  console.log(`[build:package] version ${versions.version} (build ${versions.build})`);
  return results;
}
