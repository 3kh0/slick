import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export const FLATPAK_DESKTOP_ID = 'dev.slick.Slick.desktop';

function upsert(lines: string[], section: string, key: string, value: (old: string | undefined) => string) {
  const header = lines.findIndex((line) => line.trim() === `[${section}]`);
  if (header === -1) {
    if (lines.length) lines.push('');
    lines.push(`[${section}]`, `${key}=${value(undefined)}`);
    return;
  }
  let end = header + 1;
  while (end < lines.length && !lines[end].trim().startsWith('[')) end++;
  for (let i = header + 1; i < end; i++) {
    const eq = lines[i].indexOf('=');
    if (eq !== -1 && lines[i].slice(0, eq).trim() === key) {
      lines[i] = `${key}=${value(lines[i].slice(eq + 1).trim())}`;
      return;
    }
  }
  lines.splice(header + 1, 0, `${key}=${value(undefined)}`);
}

export function withDefaultHandler(text: string, mime: string, desktopId: string): string {
  const lines = text.trim() ? text.replace(/\n+$/, '').split('\n') : [];
  upsert(lines, 'Default Applications', mime, () => desktopId);
  upsert(lines, 'Added Associations', mime, (old = '') => {
    const rest = old.split(';').filter((id) => id && id !== desktopId);
    return [desktopId, ...rest].join(';') + ';';
  });
  return `${lines.join('\n')}\n`;
}

export function claimFlatpakScheme(scheme: string): boolean {
  const configHome = process.env.HOST_XDG_CONFIG_HOME || path.join(os.homedir(), '.config');
  const file = path.join(configHome, 'mimeapps.list');
  try {
    const text = fs.readFileSync(file, 'utf8');
    const next = withDefaultHandler(text, `x-scheme-handler/${scheme}`, FLATPAK_DESKTOP_ID);
    if (next !== text) fs.writeFileSync(file, next);
    return true;
  } catch (error) {
    console.warn(`[slick] could not claim ${scheme}:// in ${file}:`, (error as Error).message);
    return false;
  }
}
