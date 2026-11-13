import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { settingsDir } from './paths.ts';

export const CODE_FORMAT = 1;
export const SHELL_FILE = 'shell.json';
export const MANIFEST = 'manifest.json';
const MAX_BOOT_ATTEMPTS = 2;

/** What the installed app was built with; a code pack only runs on the exact same shell. */
export type ShellInfo = { format: number; id: string; build: number };
export type CodeManifest = {
  format: number;
  build: number;
  version: string;
  shell: string;
  files: Record<string, string>;
};
export type CodeState = {
  active?: number;
  previous?: number;
  bad?: number[];
  booting?: { build: number; attempts: number };
  lastError?: string;
};

export const codeRoot = () => path.join(settingsDir(), 'code');
const stateFile = (root: string) => path.join(root, 'state.json');

export function readShell(resources: string): ShellInfo | null {
  try {
    const shell = JSON.parse(fs.readFileSync(path.join(resources, SHELL_FILE), 'utf8'));
    return shell?.format === CODE_FORMAT && typeof shell.id === 'string' && Number.isInteger(shell.build)
      ? shell
      : null;
  } catch {
    return null;
  }
}

export function readCodeState(root = codeRoot()): CodeState {
  try {
    const state = JSON.parse(fs.readFileSync(stateFile(root), 'utf8'));
    return state && typeof state === 'object' ? state : {};
  } catch {
    return {};
  }
}

export function writeCodeState(root: string, state: CodeState): void {
  fs.mkdirSync(root, { recursive: true });
  const temp = `${stateFile(root)}.${process.pid}.tmp`;
  fs.writeFileSync(temp, `${JSON.stringify(state, null, 2)}\n`);
  fs.renameSync(temp, stateFile(root));
}

export const sha256 = (data: Uint8Array) => createHash('sha256').update(data).digest('hex');

export function safeName(name: string): boolean {
  return /^[A-Za-z0-9_-][A-Za-z0-9_.-]*(\/[A-Za-z0-9_-][A-Za-z0-9_.-]*)*$/.test(name) && !name.includes('..');
}

export function checkManifest(manifest: CodeManifest, shell: ShellInfo, build: number): string {
  if (manifest?.format !== CODE_FORMAT) return 'unknown code pack format';
  if (manifest.build !== build) return `code pack is build ${manifest.build}, expected ${build}`;
  if (manifest.shell !== shell.id) return 'code pack was built for a different app shell';
  if (!manifest.files?.['main.js'] || !manifest.files['slick.js']) return 'code pack is missing main.js or slick.js';
  if (!Object.keys(manifest.files).every(safeName)) return 'code pack has an unsafe file name';
  return '';
}

/** '' when `dir` holds exactly what its manifest promises. */
export function verifyCodeDir(dir: string, shell: ShellInfo, build: number): string {
  let manifest: CodeManifest;
  try {
    manifest = JSON.parse(fs.readFileSync(path.join(dir, MANIFEST), 'utf8'));
  } catch {
    return 'manifest is missing';
  }
  const problem = checkManifest(manifest, shell, build);
  if (problem) return problem;
  for (const [name, digest] of Object.entries(manifest.files)) {
    try {
      if (sha256(fs.readFileSync(path.join(dir, name))) !== digest) return `${name} does not match its manifest`;
    } catch {
      return `${name} is missing`;
    }
  }
  return '';
}

export function markCodeBad(root: string, build: number, reason: string): void {
  const state = readCodeState(root);
  const bad = [...new Set([...(state.bad ?? []), build])].slice(-20);
  writeCodeState(root, {
    ...state,
    active: state.active === build ? undefined : state.active,
    booting: undefined,
    bad,
    lastError: `build ${build}: ${reason}`,
  });
}

/**
 * The installed code to boot, or null for the code inside the app. Counts the
 * attempt first, so code that never reaches markCodeHealthy is dropped.
 */
export function selectCode(resources: string, root = codeRoot()): { dir: string; build: number } | null {
  const shell = readShell(resources);
  if (!shell) return null;
  const state = readCodeState(root);
  const active = state.active;
  if (!active || active <= shell.build || state.bad?.includes(active)) return null;
  const dir = path.join(root, String(active));
  const problem = verifyCodeDir(dir, shell, active);
  if (problem) {
    markCodeBad(root, active, problem);
    return null;
  }
  const attempts = state.booting?.build === active ? state.booting.attempts : 0;
  if (attempts >= MAX_BOOT_ATTEMPTS) {
    markCodeBad(root, active, `did not start after ${attempts} attempts`);
    return null;
  }
  writeCodeState(root, { ...state, booting: { build: active, attempts: attempts + 1 } });
  return { dir, build: active };
}

export function markCodeHealthy(build: number, root = codeRoot()): void {
  const state = readCodeState(root);
  if (state.booting?.build !== build) return;
  writeCodeState(root, { ...state, booting: undefined });
}
