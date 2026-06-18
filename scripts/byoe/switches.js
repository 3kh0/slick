'use strict';

const fs = require('fs');
const path = require('path');

const DEFAULT_SWITCHES = [
  // mostly taken from openasar
  ['enable-gpu-rasterization'],
  ['enable-zero-copy'],
  ['enable-hardware-overlays', 'single-fullscreen,single-on-top,underlay'],
  ['enable-features', 'WebAssemblyLazyCompilation'],
  ['disable-renderer-backgrounding'],
  ['disable-background-timer-throttling'],
  ['disable-backgrounding-occluded-windows'],
  ['disable-features', 'IntensiveWakeUpThrottling,AllowAggressiveThrottlingWithWebSocket,CalculateNativeWinOcclusion'],
  ['autoplay-policy', 'no-user-gesture-required'],
];
const COMMA_SWITCHES = new Set(['enable-features', 'disable-features', 'enable-hardware-overlays']);

function readJson(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return fallback;
  }
}

function appendCommaSwitch(commandLine, name, values) {
  const merged = new Set(
    [commandLine.getSwitchValue(name), values]
      .flatMap((value) => String(value || '').split(','))
      .map((value) => value.trim())
      .filter(Boolean),
  );
  commandLine.appendSwitch(name, [...merged].join(','));
}

function appendSwitch(commandLine, name, value) {
  if (value && COMMA_SWITCHES.has(name)) appendCommaSwitch(commandLine, name, value);
  else if (value) commandLine.appendSwitch(name, value);
  else commandLine.appendSwitch(name);
}

function readSnappySettings({ app, pluginsDir }) {
  const settingsDir = path.join(app.getPath('userData'), 'slick');
  const enabledFile = path.join(settingsDir, 'enabled-plugins.json');
  const defaultEnabledFile = path.join(pluginsDir, 'enabled.json');
  const configured = (process.env.SLICK_PLUGINS || '').trim();
  const enabled = configured
    ? configured
        .split(',')
        .map((name) => name.trim())
        .filter(Boolean)
    : readJson(enabledFile, null) || readJson(defaultEnabledFile, []);
  if (!Array.isArray(enabled) || !enabled.includes('Snappy')) return {};
  const stored = readJson(path.join(settingsDir, 'plugin-settings.json'), {});
  return stored && stored.Snappy && typeof stored.Snappy === 'object' ? stored.Snappy : {};
}

function stubCrashReporter(crashReporter) {
  for (const method of ['start', 'addExtraParameter']) {
    try {
      Object.defineProperty(crashReporter, method, {
        configurable: true,
        writable: true,
        value: () => {},
      });
    } catch {
      try {
        crashReporter[method] = () => {};
      } catch {}
    }
  }
}

function applySwitches({ app, commandLine, crashReporter, pluginsDir, snappySettings }) {
  for (const [name, value] of DEFAULT_SWITCHES) appendSwitch(commandLine, name, value);

  const snappy = snappySettings || readSnappySettings({ app, pluginsDir });
  if (snappy.ignoreGpuBlocklist === true) commandLine.appendSwitch('ignore-gpu-blocklist');
  if (snappy.disableCrashReporter === true) {
    commandLine.appendSwitch('disable-crash-reporter');
    commandLine.appendSwitch('disable-breakpad');
    stubCrashReporter(crashReporter);
  }
  return snappy;
}

module.exports = { DEFAULT_SWITCHES, appendCommaSwitch, applySwitches, readSnappySettings, stubCrashReporter };
