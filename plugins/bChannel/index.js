'use strict';

const fs = require('fs');
const path = require('path');

const PRELOAD_ID = 'slick-bchannel-document-start';

function preloadSource(renderer) {
  return `'use strict';
try {
  if (location.origin === 'https://app.slack.com') {
    const { webFrame } = require('electron');
    webFrame.executeJavaScript(${JSON.stringify(renderer)}, true).catch((error) =>
      console.error('[bChannel] document-start injection failed:', error.message)
    );
  }
} catch (error) {
  console.error('[bChannel] preload failed:', error.message);
}
`;
}

function registerPreload(ctx) {
  const session = ctx.electron?.session?.defaultSession;
  if (!session || typeof session.registerPreloadScript !== 'function') return;

  let preloadFile;
  try {
    const settingsDir = path.join(ctx.app.getPath('userData'), 'slick');
    preloadFile = path.join(settingsDir, 'bchannel-preload.js');
    const renderer = fs.readFileSync(path.join(__dirname, 'renderer.js'), 'utf8');
    fs.mkdirSync(settingsDir, { recursive: true });
    fs.writeFileSync(preloadFile, preloadSource(renderer), { mode: 0o600 });
  } catch (error) {
    ctx.log('could not prepare document-start interception:', error.message);
    return;
  }

  try {
    session.unregisterPreloadScript(PRELOAD_ID);
  } catch {}

  try {
    session.registerPreloadScript({
      id: PRELOAD_ID,
      type: 'frame',
      filePath: preloadFile,
    });
    ctx.log('registered document-start network interception');
  } catch (error) {
    ctx.log('could not register document-start interception:', error.message);
  }
}

module.exports = {
  meta: {
    name: 'bChannel',
    description: 'Type @channel or @here and send, no permission hassles, even as a channel manager',
  },

  settings: {
    serviceUrl: {
      type: 'text',
      label: 'bChannel service URL',
      description: 'The trusted bChannel server configured for this workspace.',
      default: 'https://bc.deployor.dev',
    },
  },

  main(ctx) {
    // Beta installs already inject this renderer at document_start through the
    // shared early preload. Skip the extra session preload so the IIFE guard is
    // not racing a second copy of the same script.
    try {
      if (fs.existsSync(path.join(__dirname, '..', '..', '.slick-beta'))) {
        ctx.log('early runtime owns document-start injection');
        return;
      }
    } catch {}
    const start = () => registerPreload(ctx);
    if (typeof ctx.app?.isReady === 'function' && ctx.app.isReady()) start();
    else
      ctx.app
        ?.whenReady?.()
        .then(start)
        .catch(() => {});
  },

  css: `
    .slick-bchannel-backdrop {
      position: fixed;
      inset: 0;
      z-index: 2147483646;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 32px;
      background: rgba(0, 0, 0, .48);
      animation: slick-bchannel-fade-in 120ms ease-out;
    }
    .slick-bchannel-dialog {
      position: relative;
      z-index: 1;
      display: block;
      width: min(520px, calc(100vw - 48px));
      overflow: hidden;
      opacity: 1;
      visibility: visible;
      transform: none;
      color: var(--dt_color-content-pry, rgb(var(--sk_primary_foreground, 29, 28, 29)));
      background: var(--dt_color-surf-pry, #fff);
      border: 1px solid var(--dt_color-otl-ter, rgba(29, 28, 29, .13));
      border-radius: 12px;
      box-shadow: 0 18px 48px rgba(0, 0, 0, .28);
      animation: slick-bchannel-dialog-in 160ms cubic-bezier(.2, .8, .2, 1);
    }
    .slick-bchannel-dialog__header {
      display: flex;
      align-items: center;
      gap: 12px;
      padding: 24px 28px 12px;
    }
    .slick-bchannel-dialog__header h2 {
      flex: 1;
      margin: 0;
      font-size: 22px;
      font-weight: 700;
      line-height: 1.3;
      color: var(--dt_color-content-pry, rgb(var(--sk_primary_foreground, 29, 28, 29)));
    }
    .slick-bchannel-dialog__close {
      width: 36px;
      height: 36px;
      padding: 0;
      color: var(--dt_color-content-pry, rgb(var(--sk_primary_foreground, 29, 28, 29)));
      font-size: 25px;
      line-height: 34px;
      background: transparent;
      border: 0;
      border-radius: 6px;
      cursor: pointer;
    }
    .slick-bchannel-dialog__close:hover { background: var(--dt_color-surf-ter, rgba(29, 28, 29, .08)); }
    .slick-bchannel-dialog__body {
      padding: 0 28px 24px;
      color: var(--dt_color-content-pry, rgb(var(--sk_primary_foreground, 29, 28, 29)));
      font-size: 15px;
      line-height: 1.46;
    }
    .slick-bchannel-dialog__body p { margin: 0; white-space: pre-wrap; }
    .slick-bchannel-dialog__actions {
      display: flex;
      justify-content: flex-end;
      gap: 8px;
      padding: 20px 28px;
      border-top: 1px solid var(--dt_color-otl-ter, rgba(29, 28, 29, .13));
    }
    @keyframes slick-bchannel-fade-in { from { opacity: 0; } }
    @keyframes slick-bchannel-dialog-in { from { opacity: 0; transform: scale(.985) translateY(4px); } }
    @media (prefers-reduced-motion: reduce) {
      .slick-bchannel-backdrop, .slick-bchannel-dialog { animation: none; }
    }
  `,

  renderer: fs.readFileSync(path.join(__dirname, 'renderer.js'), 'utf8'),
};
