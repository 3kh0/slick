// Code-only updates: shell.json fingerprints everything a code pack can't
// replace, and the pack carries the JS that changes between builds.

import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { CODE_FORMAT, type ShellInfo, SHELL_FILE } from '../../src/desktop/codeBoot.ts';
import { createCodePack } from '../../src/desktop/codePack.ts';
import { DIST, DIST_DESKTOP, ROOT } from '../lib/paths.ts';
import { versions } from '../lib/versions.ts';

const CODE_FILES = ['main.js', 'preload.js', 'cssEditorPreload.js', 'cookieLoginPreload.js', 'slick.js'];
const CODE_DIRS = ['licenses'];
const BUILT_SHELL_FILES = ['boot.js'];
const BUILT_SHELL_DIRS = ['monaco'];
const SHELL_SOURCES = [
  'assets',
  'packaging/mac',
  'packaging/linux',
  'scripts/icon',
  'scripts/build/package.ts',
  'scripts/build/codePack.ts',
  'scripts/build/macSounds.ts',
  'scripts/build/linuxNatives.ts',
];
export const SHELL_DIR = path.join(DIST, 'shell');

function walk(dir: string, base = dir): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    return entry.isDirectory() ? walk(full, base) : [path.relative(base, full).split(path.sep).join('/')];
  });
}

const hashFile = (file: string) => createHash('sha256').update(readFileSync(file)).digest('hex');

/** Git blob ids, so files CI regenerates in place (Assets.car) still hash as committed. */
function sourceLines(): string[] {
  const tree = execFileSync('git', ['ls-tree', '-r', 'HEAD', '--', ...SHELL_SOURCES], { cwd: ROOT, encoding: 'utf8' });
  return tree
    .trim()
    .split('\n')
    .filter(Boolean)
    .map((line) => {
      const [meta, file] = line.split('\t');
      return `src ${file} ${meta.split(' ')[2]}`;
    })
    .toSorted();
}

export function shellInfo(platform: string, arch: string, electron: string): ShellInfo {
  const builder = createRequire(import.meta.url)('electron-builder/package.json').version;
  const built = [
    ...BUILT_SHELL_FILES,
    ...BUILT_SHELL_DIRS.flatMap((dir) => walk(path.join(DIST_DESKTOP, dir)).map((file) => `${dir}/${file}`)),
  ].toSorted();
  const lines = [
    `format ${CODE_FORMAT}`,
    `target ${platform} ${arch}`,
    `electron ${electron}`,
    `electron-builder ${builder}`,
    ...built.map((file) => `built ${file} ${hashFile(path.join(DIST_DESKTOP, file))}`),
    ...sourceLines(),
  ];
  const id = createHash('sha256').update(lines.join('\n')).digest('hex').slice(0, 16);
  return { format: CODE_FORMAT, id, build: versions.build };
}

export function writeShellInfo(shell: ShellInfo): string {
  mkdirSync(SHELL_DIR, { recursive: true });
  writeFileSync(path.join(SHELL_DIR, SHELL_FILE), `${JSON.stringify(shell, null, 2)}\n`);
  return SHELL_DIR;
}

export function writeCodePack(shell: ShellInfo, platform: string, arch: string, output: string): string {
  const files = new Map<string, Uint8Array>();
  for (const file of CODE_FILES) files.set(file, readFileSync(path.join(DIST_DESKTOP, file)));
  for (const dir of CODE_DIRS) {
    for (const file of walk(path.join(DIST_DESKTOP, dir))) {
      files.set(`${dir}/${file}`, readFileSync(path.join(DIST_DESKTOP, dir, file)));
    }
  }
  const os = platform === 'darwin' ? 'mac' : platform;
  const artifact = path.join(output, `Slick-${versions.version}-code-${os}-${arch}-${shell.id}.tar.gz`);
  mkdirSync(output, { recursive: true });
  writeFileSync(artifact, createCodePack(files, { build: versions.build, version: versions.version, shell: shell.id }));
  return artifact;
}
