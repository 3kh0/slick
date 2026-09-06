'use strict';

const fs = require('node:fs');
const path = require('node:path');

const CHANNEL = 'slick-beta-settings';
function register({
  electron,
  read,
  writeNickname,
  migrateNicknames,
  root = path.resolve(__dirname, '../..'),
  log = console.error,
}) {
  const { app, session, ipcMain, webContents } = electron;
  const preload = path.join(root, 'dist/early-extension/desktop-preload.cjs');
  const marker = fs.existsSync(path.join(root, '.slick-beta'));
  const hasPreload = fs.existsSync(preload);
  const registered = new WeakSet();
  const problems = new WeakMap();
  const allowed = (event) => {
    try {
      const url = new URL(event.senderFrame.url);
      return (
        event.senderFrame === event.sender.mainFrame &&
        registered.has(event.sender.session) &&
        url.protocol === 'https:' &&
        url.hostname === 'app.slack.com' &&
        url.pathname.startsWith('/client/')
      );
    } catch {
      return false;
    }
  };
  const inactive = {
    publish() {},
    registered: () => false,
    reason: () => (!marker ? 'stable installation' : 'beta preload missing'),
  };
  if (!marker || !hasPreload) return inactive;
  function attach(ses) {
    if (registered.has(ses)) return;
    try {
      if (typeof ses.registerPreloadScript !== 'function') {
        problems.set(ses, 'preload API unavailable');
        return;
      }
      ses.registerPreloadScript({ type: 'frame', filePath: preload });
      registered.add(ses);
      problems.delete(ses);
    } catch (error) {
      problems.set(ses, 'preload registration failed');
      log('[slick-beta] preload unavailable:', error.message);
    }
  }
  function publish() {
    for (const wc of webContents.getAllWebContents()) {
      if (wc.isDestroyed() || !registered.has(wc.session)) continue;
      try {
        wc.send(CHANNEL, read());
      } catch (error) {
        log('[slick-beta] settings push failed:', error.message);
      }
    }
  }
  ipcMain.on(CHANNEL, (event, request) => {
    if (!allowed(event)) {
      event.returnValue = null;
      return;
    }
    try {
      if (request?.type === 'nickname' && /^[UW][A-Z0-9]{6,}$/.test(request.id) && typeof request.name === 'string') {
        writeNickname(request.id, request.name.replace(/\s+/g, ' ').trim().slice(0, 24));
        publish();
      }
      if (request?.type === 'migrate-nicknames' && read().nicknames === undefined && migrateNicknames) {
        const names = {};
        if (request.names && typeof request.names === 'object' && !Array.isArray(request.names)) {
          for (const [id, raw] of Object.entries(request.names)) {
            if (!/^[UW][A-Z0-9]{6,}$/.test(id) || typeof raw !== 'string') continue;
            const name = raw.replace(/\s+/g, ' ').trim().slice(0, 24);
            if (name) names[id] = name;
          }
          migrateNicknames(names);
          publish();
        }
      }
      event.returnValue = read();
    } catch (error) {
      event.returnValue = null;
      log('[slick-beta] settings unavailable:', error.message);
    }
  });
  app.on('session-created', attach);
  if (app.isReady()) attach(session.defaultSession);
  else app.once('ready', () => attach(session.defaultSession));
  return {
    publish,
    registered: (ses) => registered.has(ses),
    reason: (ses) => problems.get(ses) || (registered.has(ses) ? '' : 'preload registration pending'),
  };
}

module.exports = { register, CHANNEL };
