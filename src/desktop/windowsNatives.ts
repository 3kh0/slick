// Slack's .node modules load into Slick.exe, which on Windows hits two walls:
//   * they need the VC++ runtime DLLs beside slack.exe, not on our loader path;
//   * MSIX Slack lives in WindowsApps, which other processes may read but not
//     load code from (ERROR_ACCESS_DENIED).
// So app.asar.unpacked is mirrored into our settings dir once per Slack
// Electron version and dlopen() is redirected to it. Standalone Slack doesn't
// need the mirror but uses it too, for a single code path.

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { settingsDir } from './paths.js';

/** Slack's full Electron version (the `version` file beside slack.exe), or a stable fallback. */
function mirrorId(appDir: string): string {
  try {
    const version = fs.readFileSync(path.join(appDir, 'version'), 'utf8').trim();
    if (version) return version;
  } catch {}
  return `unknown-${crypto.createHash('sha256').update(appDir).digest('hex').slice(0, 12)}`;
}

/** A few hundred MB each. */
function pruneMirrors(root: string, keep: string) {
  let entries: string[];
  try {
    entries = fs.readdirSync(root);
  } catch {
    return;
  }
  for (const name of entries) {
    if (name === keep) continue;
    try {
      fs.rmSync(path.join(root, name), { recursive: true, force: true });
    } catch {
      // Held open by another running Slick; the next launch retries.
    }
  }
}

/** Must run before Slack's asar is required. Returns true when it copied (for the log). */
export function prepareWindowsNatives(asar: string): boolean {
  const resources = path.dirname(asar);
  const appDir = path.dirname(resources);
  const unpacked = path.join(resources, 'app.asar.unpacked');

  process.env.PATH = [appDir, process.env.PATH || ''].filter(Boolean).join(path.delimiter);
  if (!fs.existsSync(unpacked)) return false;

  const root = path.join(settingsDir(), 'native');
  const id = mirrorId(appDir);
  const mirror = path.join(root, id, 'app.asar.unpacked');
  const ready = path.join(mirror, '.complete');
  const copied = !fs.existsSync(ready);

  if (copied) {
    // Staged then renamed, so an interrupted copy never looks complete.
    const staging = `${mirror}.tmp-${process.pid}`;
    fs.rmSync(staging, { recursive: true, force: true });
    fs.mkdirSync(path.dirname(staging), { recursive: true });
    fs.cpSync(unpacked, staging, { recursive: true });
    fs.writeFileSync(path.join(staging, '.complete'), '');
    fs.rmSync(mirror, { recursive: true, force: true });
    fs.renameSync(staging, mirror);
    pruneMirrors(root, id);
  }

  process.env.PATH = [appDir, mirror, process.env.PATH || ''].filter(Boolean).join(path.delimiter);

  const source = path.toNamespacedPath(path.resolve(unpacked)).toLowerCase() + path.sep;
  const dlopen = process.dlopen;
  process.dlopen = function slickDlopen(this: unknown, module: object, filename: string, flags?: number) {
    const resolved = path.toNamespacedPath(path.resolve(filename));
    const mapped = resolved.toLowerCase().startsWith(source)
      ? path.join(mirror, resolved.slice(source.length))
      : filename;
    return dlopen.call(this, module, mapped, flags);
  } as typeof process.dlopen;

  return copied;
}
