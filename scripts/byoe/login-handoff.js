'use strict';

const { app } = require('electron');

const PROTOCOL = 'slack';

const isSlackUrl = (v) => typeof v === 'string' && /^slack:/i.test(v);
const isEphemeralArg = (v) => isSlackUrl(v) || v === '--test-type=webdriver' || v === '--userAgent';

function registerSlackProtocol(setter) {
  const registered =
    process.platform === 'darwin'
      ? setter(PROTOCOL)
      : setter(
          PROTOCOL,
          process.execPath,
          [...process.execArgv, ...process.argv.slice(1)].filter((a) => !isEphemeralArg(a)),
        );
  if (registered === false) console.error('[slick-byoe] could not register as the slack:// handler');
  return registered;
}

const originalSetDefault = app.setAsDefaultProtocolClient.bind(app);
app.setAsDefaultProtocolClient = function patchedSetAsDefaultProtocolClient(protocol, executablePath, args) {
  if (
    protocol === PROTOCOL &&
    (process.platform === 'darwin' || process.platform === 'linux') &&
    process.env.SLICK_HANDOFF_FORCE_TARGET !== '0' &&
    !executablePath &&
    !args
  ) {
    return registerSlackProtocol(originalSetDefault);
  }
  return originalSetDefault(protocol, executablePath, args);
};

const pendingOpenUrls = [];
let replayingOpenUrl = false;
const originalEmit = app.emit.bind(app);

function replayPendingOpenUrls() {
  if (replayingOpenUrl || !pendingOpenUrls.length) return;
  replayingOpenUrl = true;
  try {
    while (pendingOpenUrls.length) originalEmit('open-url', { preventDefault() {} }, pendingOpenUrls.shift());
  } finally {
    replayingOpenUrl = false;
  }
}

const originalOn = app.on.bind(app);
app.on = function patchedOn(eventName, listener) {
  const result = originalOn(eventName, listener);
  if (eventName === 'open-url') process.nextTick(replayPendingOpenUrls);
  return result;
};

const helperOpenUrlListener = function captureOpenUrl(event, url) {
  if (event && typeof event.preventDefault === 'function') event.preventDefault();
  if (replayingOpenUrl) return;
  if (app.listeners('open-url').some((l) => l !== helperOpenUrlListener)) return;
  pendingOpenUrls.push(url);
};
originalOn('open-url', helperOpenUrlListener);

function focusExistingWindow() {
  const { BrowserWindow } = require('electron');
  for (const window of BrowserWindow.getAllWindows()) {
    if (window.isDestroyed()) continue;
    if (window.isMinimized()) window.restore();
    window.focus();
    return true;
  }
  return false;
}

if (process.platform === 'linux') {
  const gotLock = app.requestSingleInstanceLock();
  if (!gotLock) {
    app.quit();
  } else {
    app.on('second-instance', focusExistingWindow);
    app.on('open-url', focusExistingWindow);
    registerSlackProtocol(originalSetDefault);
  }
} else if (process.platform === 'darwin') {
  registerSlackProtocol(originalSetDefault);
}
