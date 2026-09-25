import { execFileSync } from 'node:child_process';
import { cp, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { DIST_DESKTOP } from '../lib/paths.ts';

const modules = [
  { package: 'native-keymap', version: '3.3.9', file: 'keymapping.node' },
  { package: 'file-handler-info', version: '0.2.1', file: 'file_handler_info.node' },
  { package: 'electron-native-auth', version: '0.1.1', file: 'electron_native_auth.node' },
];

export async function buildLinuxArm64Natives(): Promise<void> {
  if (process.platform !== 'linux' || process.arch !== 'arm64') {
    throw new Error('arm64 native addons must be built on an arm64 Linux runner');
  }
  const work = await mkdtemp(path.join(os.tmpdir(), 'slick-natives-'));
  try {
    await writeFile(path.join(work, 'package.json'), JSON.stringify({ name: 'slick-natives', private: true }));
    execFileSync(
      'npm',
      ['install', '--build-from-source', '--no-audit', '--no-fund', ...modules.map((m) => `${m.package}@${m.version}`)],
      {
        cwd: work,
        stdio: 'inherit',
      },
    );
    const dest = path.join(DIST_DESKTOP, 'native', 'linux-arm64');
    await mkdir(dest, { recursive: true });
    for (const item of modules) {
      await cp(
        path.join(work, 'node_modules', item.package, 'build', 'Release', item.file),
        path.join(dest, item.file),
      );
    }
  } finally {
    await rm(work, { recursive: true, force: true });
  }
}
