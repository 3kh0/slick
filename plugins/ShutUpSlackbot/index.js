'use strict';

const fs = require('fs');
const path = require('path');

const P = '__slickShutUpSlackbotMainP';

function decode(text) {
  return String(text == null ? '' : text)
    .replace(/<([^>|]+)\|([^>]+)>/g, '$2')
    .replace(/<([^>]+)>/g, '$1');
}

function textOfNotification(options) {
  if (!options || typeof options !== 'object') return decode(options);
  return decode(
    [options.title, options.subtitle, options.body, options.content, options.message].filter(Boolean).join(' '),
  );
}

function isSlash(text) {
  if (!text) return false;
  const x = /slash[-_\s]+commands?/i.test(text);
  const y = /(^|\s)`?\/[a-z0-9_-]+`?/i.test(text) && /\b(has been using|same command|when people enter)\b/i.test(text);
  return (x || y) && /\b(new|added|created|registered|registration|installed|enabled|configured)\b/i.test(text);
}

function shouldSuppress(options) {
  return isSlash(textOfNotification(options));
}

function patch(ctx) {
  const NativeNotification = ctx.electron && ctx.electron.Notification;
  if (!NativeNotification || !NativeNotification.prototype || NativeNotification[P]) return;

  const suppressed = new WeakSet();
  const nativeShow = NativeNotification.prototype.show;

  function SlickNotification(options) {
    const notification = new NativeNotification(options);
    if (shouldSuppress(options)) suppressed.add(notification);
    return notification;
  }

  try {
    Object.setPrototypeOf(SlickNotification, NativeNotification);
  } catch {}
  SlickNotification.prototype = NativeNotification.prototype;

  if (typeof nativeShow === 'function' && !NativeNotification.prototype[P]) {
    NativeNotification.prototype.show = function () {
      if (suppressed.has(this) || shouldSuppress(this)) return undefined;
      return nativeShow.apply(this, arguments);
    };
    Object.defineProperty(NativeNotification.prototype, P, { value: true });
  }

  Object.defineProperty(SlickNotification, P, { value: true });
  try {
    Object.defineProperty(ctx.electron, 'Notification', {
      configurable: true,
      writable: true,
      value: SlickNotification,
    });
  } catch {
    try {
      ctx.electron.Notification = SlickNotification;
    } catch {}
  }
}

function t(ctx) {
  const ses = ctx.electron && ctx.electron.session;
  const register = () => {
    const defaultSession = ses && ses.defaultSession;
    if (!defaultSession || typeof defaultSession.registerPreloadScript !== 'function') return;
    try {
      defaultSession.unregisterPreloadScript('slick-shut-up-slackbot');
    } catch {}
    try {
      defaultSession.registerPreloadScript({
        id: 'slick-shut-up-slackbot',
        type: 'frame',
        filePath: path.join(__dirname, 'preload.js'),
      });
    } catch {}
  };

  if (ctx.app && ctx.app.isReady()) register();
  else if (ctx.app && typeof ctx.app.whenReady === 'function')
    ctx.app
      .whenReady()
      .then(register)
      .catch(() => {});
}

function main(ctx) {
  patch(ctx);
  t(ctx);
}

module.exports = {
  meta: {
    name: 'ShutUpSlackbot',
    description: 'Mark Slackbot slash-command registration DMs as read and silence their notifications.',
  },

  main,
  renderer: fs.readFileSync(path.join(__dirname, 'renderer.js'), 'utf8'),
};
