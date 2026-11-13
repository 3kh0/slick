import fs from 'node:fs';
import path from 'node:path';
import { gunzipSync, gzipSync } from 'node:zlib';
import {
  checkManifest,
  type CodeManifest,
  codeRoot,
  MANIFEST,
  readCodeState,
  safeName,
  sha256,
  type ShellInfo,
  writeCodeState,
} from './codeBoot.ts';

const BLOCK = 512;
const MAX_PACK_BYTES = 64 * 1024 * 1024;

function octal(value: number, width: number): string {
  return `${value.toString(8).padStart(width - 1, '0')}\0`;
}

/** A plain ustar archive: regular files only, fixed metadata, sorted, so builds are reproducible. */
export function writeTar(files: Map<string, Uint8Array>): Buffer {
  const parts: Buffer[] = [];
  for (const name of [...files.keys()].toSorted()) {
    const data = files.get(name)!;
    if (Buffer.byteLength(name) > 100) throw new Error(`tar name too long: ${name}`);
    const header = Buffer.alloc(BLOCK);
    header.write(name, 0, 'utf8');
    header.write(octal(0o644, 8), 100);
    header.write(octal(0, 8), 108);
    header.write(octal(0, 8), 116);
    header.write(octal(data.length, 12), 124);
    header.write(octal(0, 12), 136);
    header.fill(' ', 148, 156);
    header.write('0', 156);
    header.write('ustar\0', 257);
    header.write('00', 263);
    let sum = 0;
    for (const byte of header) sum += byte;
    header.write(`${sum.toString(8).padStart(6, '0')}\0 `, 148);
    parts.push(header, Buffer.from(data), Buffer.alloc((BLOCK - (data.length % BLOCK)) % BLOCK));
  }
  parts.push(Buffer.alloc(BLOCK * 2));
  return Buffer.concat(parts);
}

export function readTar(tar: Buffer): Map<string, Buffer> {
  const files = new Map<string, Buffer>();
  let offset = 0;
  while (offset + BLOCK <= tar.length) {
    const header = tar.subarray(offset, offset + BLOCK);
    if (header.every((byte) => byte === 0)) break;
    const field = (start: number, length: number) =>
      header
        .subarray(start, start + length)
        .toString('utf8')
        .replace(/\0.*$/s, '');
    const prefix = field(345, 155);
    const name = prefix ? `${prefix}/${field(0, 100)}` : field(0, 100);
    const size = Number.parseInt(field(124, 12).trim() || '0', 8);
    const type = field(156, 1);
    if (!Number.isSafeInteger(size) || size < 0) throw new Error('corrupt tar header');
    const start = offset + BLOCK;
    if (start + size > tar.length) throw new Error('truncated tar');
    if (type === '0' || type === '') {
      if (!safeName(name)) throw new Error(`unsafe path in code pack: ${name}`);
      files.set(name, tar.subarray(start, start + size));
    } else if (type !== '5') {
      throw new Error(`unsupported entry in code pack: ${name}`);
    }
    offset = start + Math.ceil(size / BLOCK) * BLOCK;
  }
  return files;
}

export function createCodePack(files: Map<string, Uint8Array>, meta: Omit<CodeManifest, 'files' | 'format'>): Buffer {
  const manifest: CodeManifest = {
    format: 1,
    ...meta,
    files: Object.fromEntries([...files].toSorted(([a], [b]) => a.localeCompare(b)).map(([n, d]) => [n, sha256(d)])),
  };
  const all = new Map(files);
  all.set(MANIFEST, Buffer.from(`${JSON.stringify(manifest, null, 2)}\n`));
  return gzipSync(writeTar(all), { level: 9 });
}

export function openCodePack(archive: Buffer, shell: ShellInfo, build: number): Map<string, Buffer> {
  const tar = gunzipSync(archive, { maxOutputLength: MAX_PACK_BYTES });
  const files = readTar(tar);
  const raw = files.get(MANIFEST);
  if (!raw) throw new Error('code pack has no manifest');
  const manifest = JSON.parse(raw.toString('utf8')) as CodeManifest;
  const problem = checkManifest(manifest, shell, build);
  if (problem) throw new Error(problem);
  for (const name of files.keys()) {
    if (name !== MANIFEST && !Object.hasOwn(manifest.files, name))
      throw new Error(`unexpected file in code pack: ${name}`);
  }
  for (const [name, digest] of Object.entries(manifest.files)) {
    const data = files.get(name);
    if (!data || sha256(data) !== digest) throw new Error(`${name} does not match the code pack manifest`);
  }
  return files;
}

/** Unpacks next to the running code and makes it the one to boot next. */
export function installCodePack(archive: Buffer, shell: ShellInfo, build: number, root = codeRoot()): string {
  const files = openCodePack(archive, shell, build);
  const state = readCodeState(root);
  if (state.bad?.includes(build)) throw new Error(`build ${build} already failed to start here`);
  const target = path.join(root, String(build));
  const staging = `${target}.partial-${process.pid}`;
  fs.rmSync(staging, { recursive: true, force: true });
  for (const [name, data] of files) {
    const file = path.join(staging, name);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, data);
  }
  fs.rmSync(target, { recursive: true, force: true });
  fs.renameSync(staging, target);
  writeCodeState(root, {
    ...state,
    active: build,
    previous: state.active !== build ? state.active : state.previous,
    booting: undefined,
  });
  return target;
}

/** Drops code the app itself has caught up with, and anything but the active and previous builds. */
export function pruneCode(shell: ShellInfo | null, root = codeRoot()): void {
  let state = readCodeState(root);
  if (shell && state.active && state.active <= shell.build) {
    state = { ...state, active: undefined, previous: undefined, booting: undefined };
    writeCodeState(root, state);
  }
  const keep = new Set([state.active, state.previous].filter(Boolean).map(String));
  let entries: string[];
  try {
    entries = fs.readdirSync(root);
  } catch {
    return;
  }
  for (const entry of entries) {
    if (entry === 'state.json' || keep.has(entry)) continue;
    fs.rmSync(path.join(root, entry), { recursive: true, force: true });
  }
}
