// Isolated Electron proof: no real Slack requests, profiles or credentials.
// Bundle accountNavigation.ts to ACCOUNT_NAV_MODULE, then run this with Electron.
const assert = require('node:assert/strict');
const { app, BrowserWindow, session } = require('electron');
const { createAccountNavigation } = require(process.env.ACCOUNT_NAV_MODULE);

app.setPath('userData', process.env.ACCOUNT_NAV_PROFILE);
app.commandLine.appendSwitch('disable-background-networking');

app.whenReady().then(async () => {
  const windows = [];
  try {
    const isolated = session.fromPartition('account-navigation-proof');
    let changed = false;
    let oldProbes = 0;
    let leakedProbes = 0;
    let magicHits = 0;
    isolated.protocol.handle('https', async (request) => {
      const url = new URL(request.url);
      assert.equal(url.hostname, 'app.slack.com');
      if (url.pathname === '/api/auth.loginMagicBulk') {
        magicHits++;
        for (const window of windows.slice(0, 2)) {
          assert.equal(window.webContents.getURL(), 'about:blank');
          assert.match(
            await window.webContents.executeJavaScript('document.body.innerText'),
            /Finishing your Slack sign-in/,
          );
        }
        assert.equal((await isolated.cookies.get({ name: 'd' })).length, 0);
        await isolated.cookies.set({ url: 'https://app.slack.com', name: 'd', value: 'fake-new-signin-cookie' });
        return new Response('{"ok":true}', { headers: { 'Content-Type': 'application/json' } });
      }
      if (url.pathname === '/probe') {
        if (url.searchParams.get('source') === 'old') {
          oldProbes++;
          if (changed) leakedProbes++;
        }
        return new Response('ok');
      }
      const source = url.pathname.endsWith('/NEW') || url.pathname === '/client' ? 'new' : 'old';
      return new Response(
        `<!doctype html><script>
        window.source = ${JSON.stringify(source)};
        setInterval(() => fetch('/probe?source=' + window.source), 10);
        addEventListener('unload', () => localStorage.setItem('localConfig_v2', 'old-unload-flush'));
      </script>`,
        { headers: { 'Content-Type': 'text/html' } },
      );
    });
    for (let i = 0; i < 2; i++) {
      const window = new BrowserWindow({ show: false, webPreferences: { session: isolated } });
      windows.push(window);
      await window.loadURL('https://app.slack.com/client/OLD');
    }
    await new Promise((resolve) => setTimeout(resolve, 150));
    assert.ok(oldProbes > 0, 'old renderer timers must run before transition');
    const contents = windows.map((window) => window.webContents);
    const navigation = createAccountNavigation(
      () => contents,
      () => () => {},
    );
    const pending = { teamId: 'T123456', userId: 'U123456', team: { token: 'fake-target-token' } };
    await navigation.navigate(contents[0], 'https://app.slack.com/client/NEW', pending, async () => {
      for (const client of contents) assert.equal(client.getURL(), 'about:blank');
      changed = true;
      await isolated.cookies.set({ url: 'https://app.slack.com', name: 'd', value: 'fake-target-cookie' });
    });
    await new Promise((resolve) => setTimeout(resolve, 150));
    assert.equal(leakedProbes, 0, 'old-account requests must not run after cookie replacement');
    assert.equal(await contents[0].executeJavaScript('window.source'), 'new');
    assert.deepEqual(navigation.takeHandoff(contents[0]), pending);
    assert.equal(navigation.takeHandoff(contents[0]), null);
    console.log(
      'PASS: real Electron unloads both old renderers before cookie replacement; zero old-account probes afterward.',
    );
    // Reproduce Slack's native auth window and its one-shot load observer.
    changed = false;
    leakedProbes = 0;
    const previousProbes = oldProbes;
    for (const client of contents) await client.loadURL('https://app.slack.com/client/OLD');
    await new Promise((resolve) => setTimeout(resolve, 150));
    assert.ok(oldProbes > previousProbes);
    const hidden = new BrowserWindow({ show: false, webPreferences: { session: isolated } });
    windows.push(hidden);
    contents.push(hidden.webContents);
    const target = 'https://app.slack.com/api/auth.loginMagicBulk?magic_tokens=fake&ssb=1';
    const finished = new Promise((resolve) =>
      hidden.webContents.once('did-finish-load', () => resolve(hidden.webContents.getURL())),
    );
    const dispose = navigation.onSignIn(async (sender, url, options) => {
      await navigation.navigate(
        sender,
        url,
        { action: 'reset' },
        async () => {
          changed = true;
          await isolated.cookies.remove('https://app.slack.com', 'd');
        },
        options,
      );
    });
    await hidden.loadURL(target);
    assert.equal(await finished, target, 'native observer must see magic response, not an artificial blank load');
    assert.equal(magicHits, 1);
    assert.equal(contents[0].getURL(), 'https://app.slack.com/client');
    assert.equal(await contents[0].executeJavaScript('window.source'), 'new');
    await new Promise((resolve) => setTimeout(resolve, 150));
    assert.equal(leakedProbes, 0);
    dispose();
    console.log(
      'PASS: native hidden-window magic login is isolated before its request; one-shot load observer preserved.',
    );
    windows.forEach((window) => window.destroy());
    app.exit(0);
  } catch (error) {
    console.error(error);
    windows.forEach((window) => window.destroy());
    app.exit(1);
  }
});
