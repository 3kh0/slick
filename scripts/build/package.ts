// Packages the staged loader with electron-builder. Two names must not change:
//
//   * Artifact names: the installers and the updater's pickAsset match on
//     `-mac-<arch>.zip`, `-win32-<arch>.zip` and `-linux-<arch>.tar.gz`;
//     renaming silently breaks updates for existing installs.
//   * The macOS bundle id `dev.slick.byoe.handoff`: install.sh registers it as
//     the slack:// handler and existing installs have it in LaunchServices.

import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { copyFile, cp, mkdir, rename, rm } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import { Arch, archFromString, build as electronBuild, Platform } from 'electron-builder';
import { ASSETS, DIST, DIST_DESKTOP, ROOT, THEMES } from '../lib/paths.ts';
import { versions } from '../lib/versions.ts';
import { buildDesktop } from './desktop.ts';
import { buildLinuxArm64Natives } from './linuxNatives.ts';

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

const MAC_ENTITLEMENTS = path.join(ROOT, 'packaging', 'mac', 'entitlements.plist');

// Release builds sign with Developer ID and notarize (CSC_LINK, APPLE_* in
// release.yml). electron-builder wants the certificate name without its prefix.
const SIGN_IDENTITY = process.env.SLICK_SIGN_IDENTITY?.trim().replace(/^Developer ID Application:\s*/, '') || null;

/**
 * Finish the macOS bundle before electron-builder signs and zips it. Icon
 * variants go in first as they are sealed resources.
 *
 * Unsigned builds still need an ad-hoc signature: electron-builder's
 * Info.plist and Resources edits break Electron's original seal ("code has no
 * resources but signature indicates they must be present").
 */
function finishMacApp(appPath: string) {
  const car = path.join(ASSETS, 'Assets.car');
  if (existsSync(car)) {
    execFileSync('/bin/cp', [car, path.join(appPath, 'Contents', 'Resources', 'Assets.car')]);
    execFileSync('/usr/bin/plutil', [
      '-replace',
      'CFBundleIconName',
      '-string',
      'desktop',
      path.join(appPath, 'Contents', 'Info.plist'),
    ]);
  }
  if (SIGN_IDENTITY) return;
  execFileSync('/usr/bin/codesign', ['--force', '--deep', '--sign', '-', '--entitlements', MAC_ENTITLEMENTS, appPath]);
  execFileSync('/usr/bin/codesign', ['--verify', '--deep', '--strict', appPath]);
}

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
    // Older installs' launcher and updater exec Slick/electron after replacing
    // the app; keep that entry point so they can migrate.
    await copyFile(path.join(app, 'slick'), path.join(app, 'electron'));
  }

  const suffix = platform === 'win32' ? `win32-${arch}.zip` : `linux-${arch}.tar.gz`;
  const artifact = path.join(OUTPUT, `Slick-${versions.version}-${suffix}`);
  if (platform === 'win32') {
    await archive('zip', artifact, app);
  } else {
    const temporaryArtifact = path.join(stage, 'Slick.tar.gz');
    await rm(artifact, { force: true });
    // app-builder-lib's 7za fails on .tar.gz with E_INVALIDARG (Arch); system
    // tar also keeps exec bits and symlinks.
    execFileSync('tar', ['-czf', temporaryArtifact, '-C', stage, 'Slick']);
    await rename(temporaryArtifact, artifact);
  }
  await rm(stage, { recursive: true, force: true });
  return artifact;
}

export async function packageDesktop({ debug = false, platform = process.platform, arch }: PackageOptions = {}) {
  await buildDesktop({ debug });

  const selectedArch = targetArch(arch);
  if (platform === 'linux' && selectedArch !== Arch.x64 && selectedArch !== Arch.arm64) {
    throw new Error('[build:package] Linux releases require x64 or arm64');
  }
  if (platform === 'linux' && selectedArch === Arch.arm64) await buildLinuxArm64Natives();
  const selectedPlatform =
    platform === 'darwin' ? Platform.MAC : platform === 'win32' ? Platform.WINDOWS : Platform.LINUX;
  const targets = selectedPlatform.createTarget(
    platform === 'darwin' ? ['zip', 'dmg'] : platform === 'linux' ? ['dir', 'AppImage', 'deb', 'rpm'] : 'dir',
    selectedArch,
  );

  const results = await electronBuild({
    targets,
    config: {
      appId: 'dev.slick.byoe.handoff',
      productName: 'Slick',
      copyright: 'Slick contributors',
      extraMetadata: {
        description: 'Slack client mod using your installed Slack',
        homepage: 'https://github.com/3kh0/slick',
        license: 'GPL-3.0-only',
      },
      electronVersion: electronVersion(),
      // The static AppImage runtime does not require libfuse.so.2 on Arch/Omarchy.
      toolsets: platform === 'linux' ? { appimage: '1.0.3' } : undefined,

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
        ...(platform === 'linux' && selectedArch === Arch.arm64
          ? [
              { from: path.join(DIST_DESKTOP, 'native', 'linux-arm64'), to: 'native/linux-arm64' },
              { from: path.join(ROOT, 'packaging', 'linux', 'TAUT-LICENSE.txt'), to: 'TAUT-LICENSE.txt' },
            ]
          : []),
      ],

      protocols: [{ name: 'Slack URL', schemes: ['slack'] }],

      mac: {
        category: 'public.app-category.productivity',
        icon: path.join(ASSETS, 'desktop.icns'),
        target: [{ target: 'zip', arch: ['arm64', 'x64'] }],
        artifactName: 'Slick-${version}-mac-${arch}.${ext}',
        identity: SIGN_IDENTITY,
        hardenedRuntime: true,
        entitlements: MAC_ENTITLEMENTS,
        entitlementsInherit: MAC_ENTITLEMENTS,
        notarize: SIGN_IDENTITY ? undefined : false,
      },

      win: {
        icon: path.join(ASSETS, 'icon.ico'),
        target: [{ target: 'zip', arch: ['x64', 'arm64'] }],
        artifactName: 'Slick-${version}-win32-${arch}.${ext}',
      },

      linux: {
        // install-linux.sh and the .desktop Exec line name it.
        executableName: 'slick',
        category: 'Network;InstantMessaging',
        icon: path.join(ASSETS, 'desktop-linux'),
        target: [
          { target: 'AppImage', arch: ['x64', 'arm64'] },
          { target: 'deb', arch: ['x64', 'arm64'] },
          { target: 'rpm', arch: ['x64', 'arm64'] },
        ],
        desktop: { entry: { Name: 'Slick', MimeType: 'x-scheme-handler/slack;' } },
      },
      appImage: {
        artifactName:
          selectedArch === Arch.arm64
            ? 'Slick-${version}-linux-aarch64.AppImage'
            : 'Slick-${version}-linux-x86_64.AppImage',
        executableArgs: ['--no-sandbox'],
      },
      deb: {
        artifactName: selectedArch === Arch.arm64 ? 'slick_${version}_arm64.deb' : 'slick_${version}_amd64.deb',
        packageName: 'slick',
        maintainer: 'Echo <github@3kh0.net>',
      },
      rpm: {
        artifactName: selectedArch === Arch.arm64 ? 'slick-${version}.aarch64.rpm' : 'slick-${version}.x86_64.rpm',
        packageName: 'slick',
        maintainer: 'Echo <github@3kh0.net>',
      },

      afterPack: async (context) => {
        if (context.electronPlatformName !== 'darwin') return;
        finishMacApp(path.join(context.appOutDir, `${context.packager.appInfo.productFilename}.app`));
      },

      // release.yml uploads and attests.
      publish: null,
    },
  });

  if (platform !== 'darwin') results.push(await legacyArchive(platform, Arch[selectedArch]));
  for (const artifact of results) console.log(`[build:package] ${path.relative(ROOT, artifact)}`);
  console.log(`[build:package] version ${versions.version} (build ${versions.build})`);
  return results;
}
