// Slick Desktop Main
// Boot order: prefs -> find Slack -> preflight -> patch electron -> require Slack.
//
// Everything Slick does to Slack happens through the electron module patch in
// patch.ts, applied before Slack's asar is required. Slack then runs its own
// main process believing it is in its own bundle.

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
import { applyPatches } from './patch.js';
import { findSlackAsar, macSlackElectronMajor } from './slackFinder.js';
import { privilegedSchemes, setupSession } from './session.js';

const cjsRequire = createRequire(import.meta.url);
const __dirname = path.dirname(fileURLToPath(import.meta.url));

// patch.ts spoofs process.resourcesPath to Slack's; keep ours first.
const slickResourcesPath = process.resourcesPath;

protocol.registerSchemesAsPrivileged(privilegedSchemes());

const slackAsar = findSlackAsar();

if (!slackAsar) {
  app.whenReady().then(() => {
    dialog.showMessageBoxSync({
      type: 'error',
      title: 'Slick',
      message: 'Slack is not installed',
      detail:
        'Slick runs the official Slack app’s own code, so Slack has to be installed first. ' +
        'Install Slack, then open Slick again.',
      buttons: ['Quit'],
    });
    app.exit(1);
  });
} else {
  startSlack(slackAsar);
}

/**
 * Slick's Electron major has to match the one Slack ships, or Slack's native
 * modules will not load. v1 gated on this in each handoff builder.
 */
function electronMajorMismatch(asar: string): { ours: number; theirs: number } | null {
  if (process.env.SLICK_SKIP_PREFLIGHT === '1') return null;
  if (process.platform !== 'darwin') return null; // win/linux read a `version` file; wired up in Phase 6

  const ours = Number.parseInt(process.versions.electron.split('.')[0], 10) || 0;
  const theirs = macSlackElectronMajor(path.dirname(asar));
  if (!ours || !theirs || ours === theirs) return null;
  return { ours, theirs };
}

function startSlack(asar: string) {
  const mismatch = electronMajorMismatch(asar);
  if (mismatch) {
    app.whenReady().then(() => {
      const choice = dialog.showMessageBoxSync({
        type: 'warning',
        title: 'Slick',
        message: 'Slick and Slack expect different Electron versions',
        detail:
          `Slick is on Electron ${mismatch.ours}, the installed Slack is on ${mismatch.theirs}. ` +
          'Running them together usually fails. Update Slick, or launch anyway to try.',
        buttons: ['Quit', 'Launch Anyway'],
        defaultId: 0,
        cancelId: 0,
      });
      if (choice !== 1) app.exit(1);
    });
  }

  // Main halves boot before app-ready, because privileged schemes and
  // Chromium switches can only be registered that early.
  registerMainPlugins(mainPlugins, pluginMeta);
  // Null means the file exists but did not parse: leave the resolved defaults
  // alone rather than treating a damaged file as an instruction.
  const stored = readStoredSettings();
  if (stored) updateSettings(stored);
  bootMainPlugins();

  applyPatches(asar, path.join(__dirname, 'preload.js'), windowCreated);
  setupBridge();
  setupPluginRpc();

  app.whenReady().then(async () => {
    setupSession([slickResourcesPath, __dirname]);
    await readyMainPlugins();
    // Edits to the settings file reach both halves: the main plugins through
    // their ctx, the renderer through the bridge's change event.
    watchSettings((text, settings) => {
      updateSettings(settings);
      broadcast('slick:settings-changed', text);
    });
  });

  process.on('uncaughtException', (error) => console.error('[slick] uncaught exception:', error));
  process.on('unhandledRejection', (reason) => console.error('[slick] unhandled rejection:', reason));

  const version = typeof __SLICK_VERSION__ === 'string' ? __SLICK_VERSION__ : 'dev';
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
