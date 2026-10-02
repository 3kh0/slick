import type { PendingAccountSwitch } from '../app/api/accounts.ts';
import type { AccountDiagnosticDetails } from './accountDiagnostics.ts';

const SLACK_HOME = 'https://app.slack.com/client';
const isClient = (url: string) => /^https:\/\/app\.slack\.com\/client(?:\/|$)/.test(url);

// No old workspace tokens or one-use sign-in URLs are embedded in this page.
const signInPage = (failed = false) => `<!doctype html><meta charset="utf-8"><title>Slick sign-in</title>
<body style="margin:0;background:#161616;color:#eee;font:16px system-ui;display:grid;place-items:center;min-height:100vh">
<main style="max-width:420px;padding:32px"><h2>${failed ? 'Sign-in needs attention' : 'Finishing your Slack sign-in…'}</h2>
<p style="line-height:1.6;color:#aaa">${failed ? 'Finish signing in in your browser, then continue to Slack. Your saved accounts are still available.' : 'Your previous account is safely paused. This window will reopen Slack when sign-in completes.'}</p>
<a href="${SLACK_HOME}" style="display:inline-block;padding:12px 18px;border-radius:8px;background:#7545c4;color:white;text-decoration:none">Continue to Slack</a>
<p style="font-size:12px;color:#aaa">Troubleshooting details are saved in account-switcher.log. No sign-in links or credentials are recorded.</p></main></body>`;

export function isSsbSignIn(value: string): boolean {
  try {
    const url = new URL(value);
    return (
      url.protocol === 'https:' &&
      !url.username &&
      !url.password &&
      (url.hostname === 'slack.com' || url.hostname.endsWith('.slack.com')) &&
      // Native AuthRequest/clipboard magic links mutate the same cookie jar
      // through a hidden BrowserWindow, without visiting /ssb/redirect.
      ['/ssb/redirect', '/api/auth.loginMagic', '/api/auth.loginMagicBulk'].includes(url.pathname)
    );
  } catch {
    return false;
  }
}

export type AccountHandoff = PendingAccountSwitch | { action: 'reset' };

export function createAccountNavigation(
  all: () => Electron.WebContents[],
  subscribe: (listener: (contents: Electron.WebContents) => void) => () => void,
  barrier: (session: Electron.Session, allowed: (contents: Electron.WebContents) => boolean) => () => void = () =>
    () => {},
  log: (event: string, details: AccountDiagnosticDetails) => void = () => {},
) {
  const handoffs = new Map<number, AccountHandoff>();
  const ownedNavigations = new Set<Electron.WebContents>();
  const parked = new Set<Electron.WebContents>();
  let busy = false;
  let generation = 0;
  const report = (event: string, details: AccountDiagnosticDetails) => {
    try {
      log(event, details);
    } catch {
      /* Diagnostics never break sign-in. */
    }
  };
  const load = (contents: Electron.WebContents, target: string, init?: Electron.LoadURLOptions) =>
    (originals.get(contents) ?? contents.loadURL).call(contents, target, init);
  const paint = async (contents: Electron.WebContents, failed = false) => {
    if (contents.isDestroyed() || contents.getURL() !== 'about:blank' || !contents.executeJavaScript) return;
    // Paint without a second navigation: native auth owns one-shot load observers.
    await contents
      .executeJavaScript(`document.documentElement.innerHTML = ${JSON.stringify(signInPage(failed))}`)
      .catch(() => {});
  };
  let transitioning: Electron.Session | undefined;
  let signIn:
    | ((sender: Electron.WebContents, url: string, options?: Electron.LoadURLOptions) => Promise<void>)
    | undefined;
  const originals = new Map<Electron.WebContents, Electron.WebContents['loadURL']>();

  const navigate = async (
    sender: Electron.WebContents,
    url: string,
    pending: AccountHandoff,
    mutate: () => Promise<void>,
    options?: Electron.LoadURLOptions,
  ) => {
    if (busy) throw new Error('An account transition is already in progress.');
    if (sender.isDestroyed()) throw new Error('The Slack window closed.');
    busy = true;
    const attempt = ++generation;
    const signingIn = 'action' in pending && isSsbSignIn(url);
    const cookieSession = sender.session;
    report('transition.start', { senderId: sender.id, action: 'action' in pending ? 'reset' : 'switch' });
    transitioning = sender.session;
    const unblock = barrier(sender.session, (contents) => contents === sender && ownedNavigations.has(sender));
    const clients = [...new Set([...all(), sender])].filter(
      (contents) =>
        !contents.isDestroyed() &&
        contents.session === sender.session &&
        (contents === sender || parked.has(contents) || contents.getURL().startsWith('https://app.slack.com/')),
    );
    report('transition.clients', { senderId: sender.id, clientCount: clients.length });
    let stage: AccountDiagnosticDetails['stage'] = 'park';
    try {
      // Blank navigation unloads JS, timers and sockets; stop() alone does not.
      for (const contents of clients) {
        // A newly created native auth window already has no running Slack JS.
        // Loading about:blank there would consume Slack's one-shot
        // did-finish-load listener before the actual magic-login response.
        if (contents.getURL() && contents.getURL() !== 'about:blank') {
          await load(contents, 'about:blank');
          parked.add(contents);
        }
      }
      report('transition.parked', { senderId: sender.id, clientCount: clients.length });
      stage = 'clear';
      await sender.session.clearStorageData({
        origin: 'https://app.slack.com',
        // Clear stale workspace tokens even if the next load/preload fails.
        // Encrypted saved accounts and Slick settings live outside this storage.
        storages: ['localstorage', 'indexdb', 'serviceworkers', 'cachestorage'],
      });
      stage = 'mutate';
      await mutate();
      report('transition.cookies-ready', { senderId: sender.id });
      if ('action' in pending) {
        for (const client of clients) if (client !== sender || isClient(url)) await paint(client);
      }
      // Delivered by the preload, after unload and before Slack's next boot.
      if (!('action' in pending)) handoffs.set(sender.id, pending);
      ownedNavigations.add(sender);
      stage = 'load';
      await load(sender, url, options);
      if (!sender.isDestroyed() && sender.getURL() !== 'about:blank') parked.delete(sender);
      report('transition.loaded', { senderId: sender.id, destroyed: sender.isDestroyed() });
    } catch (error) {
      report('transition.failed', { senderId: sender.id, stage, reason: 'failed' });
      for (const client of clients) await paint(client, true);
      // Do not restart an old token against a partially replaced/new cookie jar.
      // The parked window can be recovered by signing in again.
      handoffs.delete(sender.id);
      if (!sender.isDestroyed() && sender.getURL() === 'about:blank') {
        const html = signInPage(true);
        await load(sender, `data:text/html,${encodeURIComponent(html)}`).catch(() => {});
      }
      throw error;
    } finally {
      ownedNavigations.delete(sender);
      unblock();
      transitioning = undefined;
      busy = false;
    }
    if (signingIn && attempt === generation) {
      // Native auth owns the hidden window and may close it as soon as its JSON
      // response is consumed. Reopen a parked client, not that disposable window.
      // Storage was cleared BEFORE sign-in; never restore the old workspace here.
      try {
        const cookie = cookieSession.cookies
          ? (await cookieSession.cookies.get({ url: 'https://app.slack.com', name: 'd' }))[0]
          : undefined;
        if (attempt !== generation) return;
        // Slack may already have resumed its main window during the cookie
        // lookup. Never overwrite a new route or create a duplicate client.
        if (clients.some((client) => !client.isDestroyed() && isClient(client.getURL()))) {
          report('signin.complete', { senderId: sender.id, success: true });
          return;
        }
        const destination =
          clients.find((client) => client !== sender && !client.isDestroyed() && client.getURL() === 'about:blank') ??
          (!sender.isDestroyed() &&
          isSsbSignIn(sender.getURL()) &&
          new URL(sender.getURL()).pathname === '/ssb/redirect'
            ? sender
            : undefined);
        if (cookie?.value && destination) {
          report('signin.resume', { senderId: sender.id, webContentsId: destination.id });
          await load(destination, SLACK_HOME);
          parked.delete(destination);
          report('signin.complete', { webContentsId: destination.id, success: true });
        } else {
          report('signin.waiting', { senderId: sender.id, cookieCount: cookie?.value ? 1 : 0 });
          for (const client of clients) await paint(client, true);
        }
      } catch {
        report('signin.resume-failed', { senderId: sender.id, reason: 'failed' });
        for (const client of clients) await paint(client, true);
      }
    }
  };

  const watch = (contents: Electron.WebContents) => {
    if (originals.has(contents)) return;
    const original = contents.loadURL;
    originals.set(contents, original);
    contents.loadURL = function (url, options) {
      if (transitioning === contents.session && url !== 'about:blank')
        return Promise.reject(new Error('An account transition is already in progress.'));
      if (signIn && isSsbSignIn(url)) {
        report('signin.intercept', { webContentsId: contents.id, source: 'load-url' });
        return signIn(contents, url, options);
      }
      return original.call(this, url, options);
    };
    const onNavigate = (event: Electron.Event, url: string) => {
      if (transitioning === contents.session && !ownedNavigations.has(contents)) {
        event.preventDefault();
        return;
      }
      if (ownedNavigations.has(contents) || !signIn || !isSsbSignIn(url)) return;
      event.preventDefault();
      report('signin.intercept', { webContentsId: contents.id, source: 'navigation' });
      void signIn(contents, url).catch(() => {
        report('signin.intercept-failed', { webContentsId: contents.id, reason: 'failed' });
        console.error('[slick] Account sign-in isolation failed; sign-in was not continued.');
      });
    };
    contents.on('will-navigate', onNavigate);
    contents.on('will-redirect', onNavigate);
    const finished = () =>
      report('window.loaded', { webContentsId: contents.id, success: isClient(contents.getURL()) });
    const failed = (_event: Electron.Event, _code: number, _description: string, _url: string, mainFrame: boolean) => {
      if (mainFrame) report('window.load-failed', { webContentsId: contents.id, reason: 'failed' });
    };
    const crashed = () => report('window.renderer-gone', { webContentsId: contents.id, reason: 'failed' });
    contents.on('did-finish-load', finished);
    contents.on('did-fail-load', failed);
    contents.on('render-process-gone', crashed);
    contents.once('destroyed', () => {
      report('window.closed', { webContentsId: contents.id });
      originals.delete(contents);
      parked.delete(contents);
    });
    cleanups.push(() => {
      if (!contents.isDestroyed()) {
        contents.loadURL = original;
        contents.removeListener('will-navigate', onNavigate);
        contents.removeListener('will-redirect', onNavigate);
        contents.removeListener('did-finish-load', finished);
        contents.removeListener('did-fail-load', failed);
        contents.removeListener('render-process-gone', crashed);
      }
    });
  };
  const cleanups: (() => void)[] = [];
  return {
    navigate,
    interceptSignIn(sender: Electron.WebContents, url: string) {
      if (!signIn || !isSsbSignIn(url)) return false;
      report('signin.intercept', { senderId: sender.id, source: 'popup' });
      void signIn(sender, url).catch(() => {
        report('signin.intercept-failed', { senderId: sender.id, reason: 'failed' });
        console.error('[slick] Account sign-in isolation failed; sign-in was not continued.');
      });
      return true;
    },
    takeHandoff(sender: Electron.WebContents) {
      const pending = handoffs.get(sender.id) ?? null;
      handoffs.delete(sender.id);
      return pending;
    },
    onSignIn(handler: (sender: Electron.WebContents, url: string, options?: Electron.LoadURLOptions) => Promise<void>) {
      signIn = handler;
      all().forEach(watch);
      const unsubscribe = subscribe(watch);
      return () => {
        signIn = undefined;
        unsubscribe();
        cleanups.splice(0).forEach((cleanup) => cleanup());
        originals.clear();
      };
    },
  };
}
