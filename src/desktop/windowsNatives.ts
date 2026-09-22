// Slick Desktop Windows Native Modules
// Ported from scripts/byoe/build-handoff-app-win.js, which v1 needed and v2
// had dropped.
//
// Slick runs Slack's code in Slick's own process, so Slack's native (.node)
// modules load into Slick.exe. Two things stand in the way on Windows:
//
//   * The modules depend on the VC++ runtime DLLs that ship next to slack.exe,
//     one directory above `resources`, which is not on Slick's loader path.
//   * The Microsoft Store (MSIX) build lives in WindowsApps. Windows lets
//     another process read files there but refuses to load executable code
//     from it (ERROR_ACCESS_DENIED), so `require()` of any .node file fails.
//
// The fix is a mirror: copy app.asar.unpacked into Slick's own settings
// directory once per Slack Electron version, and route dlopen() for anything
// under Slack's unpacked directory to the copy. The standalone build does not
// need the mirror, but going through it costs one copy per Slack update and
// keeps a single code path.

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

/** Mirrors left behind by earlier Slack versions; a few hundred MB each over time. */
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

/**
 * Must run before Slack's asar is required. Returns true when it had to copy,
 * so a slow first launch after a Slack update can be told apart in the log.
 */
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
    // Staged and renamed into place, so an interrupted copy is never mistaken
    // for a complete one.
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
