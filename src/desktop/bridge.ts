// Core renderer<->main channel. Per-plugin RPC is separate and
// capability-gated; see pluginHost.ts.

import { promises as fs } from 'node:fs';
import path from 'node:path';
import { dialog, ipcMain, webContents } from 'electron';
import { configDir, profileDir, settingsDir } from './paths.js';
import { setupBlobRpc } from './pluginHost.js';
import { appUrl } from './session.js';
import { createCssEditor } from './windows/cssEditor.js';

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
  let temp = '';
  try {
    await fs.mkdir(settingsDir(), { recursive: true });
    const file = path.join(settingsDir(), name);
    temp = `${file}.${process.pid}.${Date.now()}.tmp`;
    // Write-then-rename so a crash never leaves a truncated file.
    await fs.writeFile(temp, text, 'utf8');
    await fs.rename(temp, file);
    return true;
  } catch (error) {
    if (temp) await fs.rm(temp, { force: true }).catch(() => {});
    console.error(`[slick] could not write ${name}:`, error);
    return false;
  }
}

/**
 * Built lazily so its ipcMain handlers aren't registered in every session.
 * Saves go through the same file and broadcast as writeUserCss.
 */
let editor: ReturnType<typeof createCssEditor> | null = null;
function cssEditor() {
  editor ??= createCssEditor({
    preload: path.join(import.meta.dirname, 'cssEditorPreload.js'),
    read: () => readFile(USER_CSS_FILE, ''),
    write: async (css: string) => {
      const ok = await writeFile(USER_CSS_FILE, css);
      if (ok) broadcast('slick:user-css-changed', css);
      return ok;
    },
  });
  return editor;
}

export function broadcast(channel: string, ...args: unknown[]) {
  for (const contents of webContents.getAllWebContents()) {
    if (contents.isDestroyed()) continue;
    if (!isSlackClient(contents.mainFrame)) continue;
    try {
      contents.send(channel, ...args);
    } catch {}
  }
}

const methods: Record<string, (args: any[]) => unknown> = {
  readSettings: () => readFile(SETTINGS_FILE, '{}'),
  writeSettings: ([text]) => writeFile(SETTINGS_FILE, String(text ?? '')),
  readUserCss: () => readFile(USER_CSS_FILE, ''),
  writeUserCss: async ([css]) => {
    const text = String(css ?? '');
    const ok = await writeFile(USER_CSS_FILE, text);
    if (ok && editor) editor.update(text);
    return ok;
  },

  async openFile([title, accept]) {
    const extensions =
      typeof accept === 'string'
        ? accept
            .split(',')
            .map((part) => /^\.([a-z0-9]+)$/i.exec(part.trim())?.[1]?.toLowerCase())
            .filter((extension): extension is string => !!extension)
        : [];
    const result = await dialog.showOpenDialog({
      title: typeof title === 'string' ? `Choose ${title}` : 'Choose file',
      properties: ['openFile'],
      filters: extensions.length
        ? [{ name: typeof title === 'string' ? title : 'File', extensions: [...new Set(extensions)] }]
        : undefined,
    });
    return result.canceled ? '' : (result.filePaths[0] ?? '');
  },

  openCssEditor: () => cssEditor().open(),

  // For cross-origin requests plugins can't make from the page. Text only.
  async fetch([url, init]) {
    const response = await fetch(String(url), init);
    return { status: response.status, body: await response.text() };
  },

  ...setupBlobRpc(),
};

export function setupBridge() {
  ipcMain.handle('slick:get-app-url', () => appUrl());

  ipcMain.handle('slick:get-paths', () => ({
    config: configDir(),
    profile: profileDir(),
    settings: settingsDir(),
  }));

  // --safe-mode boots Slick's runtime with no plugins, for a bad plugin release.
  ipcMain.handle('slick:get-safe-mode', () => safeMode());

  ipcMain.handle('slick:rpc', (event, method: string, args: unknown[]) => {
    if (!isSlackClient(event.senderFrame)) throw new Error('[slick] rejected sender');
    if (!Object.hasOwn(methods, method)) throw new Error(`[slick] unknown method: ${method}`);
    if (!Array.isArray(args)) throw new Error('[slick] bad args');
    return methods[method](args);
  });
}
