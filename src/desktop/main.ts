// Boot order: stage Slack update -> find Slack -> preflight -> patch electron
// (patch.ts) -> require Slack's asar.

import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { app, dialog, protocol } from 'electron';
import { broadcast, setupBridge } from './bridge.js';
import { mainPlugins, pluginMeta } from './mainPlugins.generated.js';
import {
  bootMainPlugins,
  readyMainPlugins,
  registerMainPlugins,
  setupPluginRpc,
  updateSettings,
  windowCreated,
} from './pluginHost.js';
import { readStoredSettings, watchSettings } from './settingsFile.js';
import { applyPatches, setMenuHandlers } from './patch.js';
import { findSlackAsar, macSlackApp, slackElectronMajor } from './slackFinder.js';
import { privilegedSchemes, setupSession } from './session.js';
import { createSlackUpdater } from './slackUpdater.js';
import { createUpdater } from './updater.js';
import { prepareWindowsNatives } from './windowsNatives.js';

const cjsRequire = createRequire(import.meta.url);
const __dirname = path.dirname(fileURLToPath(import.meta.url));

// patch.ts spoofs process.resourcesPath to Slack's; keep ours first.
const slickResourcesPath = process.env.SLICK_RESOURCES_PATH || process.resourcesPath;

protocol.registerSchemesAsPrivileged(privilegedSchemes());

const version = typeof __SLICK_VERSION__ === 'string' ? __SLICK_VERSION__ : 'dev';
const build = typeof __SLICK_BUILD__ === 'number' ? __SLICK_BUILD__ : 0;

// Before findSlackAsar: this can replace the bundle it resolves. Uses the pinned
// Slack, not always /Applications.
const slackUpdater = createSlackUpdater({ version, slackApp: macSlackApp() });
slackUpdater.applyStagedIfAny();

const slackAsar = findSlackAsar();

if (!slackAsar) {
  app.whenReady().then(() => {
    dialog.showMessageBoxSync({
      type: 'error',
      title: 'Slick',
      message: 'Slack is not installed',
      detail:
        'Slick runs the official Slack app’s own code, so Slack has to be installed first. ' +
        (process.platform === 'linux'
          ? 'Install the official Slack desktop app from https://slack.com/downloads/linux (or your distro’s Slack package), then open Slick again. Slick looks for Slack in /usr/lib/slack and /opt/Slack.'
          : 'Install Slack, then open Slick again.'),
      buttons: ['Quit'],
    });
    app.exit(1);
  });
} else {
  startSlack(slackAsar);
}

/** Slack's native modules only load under a matching Electron major. */
function electronMajorMismatch(asar: string): { ours: number; theirs: number } | null {
  if (process.env.SLICK_SKIP_PREFLIGHT === '1') return null;

  const ours = Number.parseInt(process.versions.electron.split('.')[0], 10) || 0;
  const theirs = slackElectronMajor(asar);
  if (!ours || !theirs || ours === theirs) return null;
  return { ours, theirs };
}

/**
 * Decided before Slack is required: a mismatched bundle can crash the process in
 * the native module loader first. The dialog only works after app-ready, so ask
 * then, and relaunch with the preflight off to go ahead.
 */
function askLaunchAnyway(mismatch: { ours: number; theirs: number }) {
  const detail =
    `Slick is on Electron ${mismatch.ours}, the installed Slack is on ${mismatch.theirs}. ` +
    'Running them together usually fails. Update Slick, or launch anyway to try.';
  console.error(`[slick] ${detail}`);
  app.whenReady().then(() => {
    const choice = dialog.showMessageBoxSync({
      type: 'warning',
      title: 'Slick',
      message: 'Slick and Slack expect different Electron versions',
      detail,
      buttons: ['Quit', 'Launch Anyway'],
      defaultId: 0,
      cancelId: 0,
    });
    if (choice === 1) {
      process.env.SLICK_SKIP_PREFLIGHT = '1';
      app.relaunch();
      app.exit(0);
    } else {
      app.exit(1);
    }
  });
}

function startSlack(asar: string) {
  const mismatch = electronMajorMismatch(asar);
  if (mismatch) {
    askLaunchAnyway(mismatch);
    return;
  }

  if (process.platform === 'win32') {
    try {
      if (prepareWindowsNatives(asar)) console.log('[slick] mirrored Slack native modules');
    } catch (error) {
      // Slack's own require() reports the failure that matters, if any.
      console.error('[slick] could not mirror Slack native modules:', error);
    }
  }

  // Before app-ready: privileged schemes and switches must register that early.
  registerMainPlugins(mainPlugins, pluginMeta);
  // Null means the file didn't parse: keep defaults rather than obey a damaged file.
  const stored = readStoredSettings();
  if (stored) updateSettings(stored);
  bootMainPlugins();

  applyPatches(asar, path.join(__dirname, 'preload.js'), windowCreated);
  setupBridge();
  setupPluginRpc();

  // patch.ts no-ops Slack's autoUpdater, so Slick updates both itself and Slack.
  const updater = createUpdater({ version, build });
  setMenuHandlers({ checkForUpdates: () => void updater.manualCheckForUpdates() });
  updater.scheduleUpdateChecks();
  slackUpdater.scheduleChecks();

  app.whenReady().then(async () => {
    setupSession([slickResourcesPath, __dirname]);
    await readyMainPlugins();
    watchSettings((text, settings) => {
      updateSettings(settings);
      broadcast('slick:settings-changed', text);
    });
  });

  process.on('uncaughtException', (error) => console.error('[slick] uncaught exception:', error));
  process.on('unhandledRejection', (reason) => console.error('[slick] unhandled rejection:', reason));

  console.log(`[slick] ${version} loading Slack from ${asar}`);

  try {
    cjsRequire(asar);
  } catch (error) {
    console.error('[slick] failed to load Slack:', error);
    app.whenReady().then(() => {
      dialog.showMessageBoxSync({
        type: 'error',
        title: 'Slick',
        message: 'Failed to load Slack',
        detail: String(error),
        buttons: ['Quit'],
      });
      app.exit(1);
    });
  }
}
