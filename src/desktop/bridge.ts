// Slick Desktop Bridge
// The core renderer<->main channel. Replaces v1's `https://slick.control/?op=`
// cancelled-fetch hack (scripts/byoe/inject.js:313-385), which existed only
// because executeJavaScript'd page code had no real way to reach main.
//
// Per-plugin RPC lives on a separate, capability-gated channel; see pluginHost.ts.

import { promises as fs } from 'node:fs';
import path from 'node:path';
import { ipcMain, webContents } from 'electron';
import { configDir, profileDir, settingsDir } from './paths.js';
import { appUrl } from './session.js';

const SETTINGS_FILE = 'settings.json';
const USER_CSS_FILE = 'custom.css';

export function safeMode(): boolean {
  return process.argv.includes('--safe-mode') || process.env.SLICK_SAFE_MODE === '1';
}

/** Only the Slack client's own main frame may talk to us. */
export function isSlackClient(frame: Electron.WebFrameMain | null): boolean {
  if (!frame) return false;
  try {
    const url = new URL(frame.url);
    return url.protocol === 'https:' && url.hostname === 'app.slack.com' && url.pathname.startsWith('/client');
  } catch {
    return false;
  }
}

async function readFile(name: string, fallback: string): Promise<string> {
  try {
    return await fs.readFile(path.join(settingsDir(), name), 'utf8');
  } catch {
    return fallback;
  }
}

async function writeFile(name: string, text: string): Promise<boolean> {
  try {
    await fs.mkdir(settingsDir(), { recursive: true });
    await fs.writeFile(path.join(settingsDir(), name), text, 'utf8');
    return true;
  } catch (error) {
    console.error(`[slick] could not write ${name}:`, error);
    return false;
  }
}

/** Push to every live Slack client renderer. */
export function broadcast(channel: string, ...args: unknown[]) {
  for (const contents of webContents.getAllWebContents()) {
    if (contents.isDestroyed()) continue;
    if (!isSlackClient(contents.mainFrame)) continue;
    try {
      contents.send(channel, ...args);
    } catch {}
  }
}

const methods: Record<string, (args: unknown[]) => unknown> = {
  readSettings: () => readFile(SETTINGS_FILE, '{}'),
  writeSettings: ([text]) => writeFile(SETTINGS_FILE, String(text ?? '')),
  readUserCss: () => readFile(USER_CSS_FILE, ''),
  writeUserCss: ([css]) => writeFile(USER_CSS_FILE, String(css ?? '')),
};

export function setupBridge() {
  ipcMain.handle('slick:get-app-url', () => appUrl());

  ipcMain.handle('slick:get-paths', () => ({
    config: configDir(),
    profile: profileDir(),
    settings: settingsDir(),
  }));

  // Escape hatch for a bad plugin release: --safe-mode boots Slick's runtime
  // but loads no plugins at all.
  ipcMain.handle('slick:get-safe-mode', () => safeMode());

  ipcMain.handle('slick:rpc', (event, method: string, args: unknown[]) => {
    if (!isSlackClient(event.senderFrame)) throw new Error('[slick] rejected sender');
    if (!Object.hasOwn(methods, method)) throw new Error(`[slick] unknown method: ${method}`);
    if (!Array.isArray(args)) throw new Error('[slick] bad args');
    return methods[method](args);
  });

  // Reserved for the file watchers that push settings/CSS changes back to the
  // page; wired up in Phase 4 alongside the settings tab.
  ipcMain.handle('slick:start', () => true);
}
