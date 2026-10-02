import path from 'node:path';
import { BrowserWindow, ipcMain, nativeTheme } from 'electron';
import latoRegular from '@fontsource/lato/files/lato-latin-400-normal.woff2';
import latoBold from '@fontsource/lato/files/lato-latin-700-normal.woff2';

export function cookieLoginHtml() {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; font-src data:; script-src 'unsafe-inline'; style-src 'unsafe-inline'; connect-src 'none'; form-action 'none'">
<title>Sign in with cookies</title><style>
@font-face{font-family:Slack-Lato;src:url("${latoRegular}") format('woff2');font-weight:400;font-display:swap}
@font-face{font-family:Slack-Lato;src:url("${latoBold}") format('woff2');font-weight:700;font-display:swap}
:root{color-scheme:light dark;font:15px/1.4667 Slack-Lato,Arial,sans-serif;--surface:#fff;--text:#1d1c1d;--muted:#616061;--border:#1d1c1d4d;--subtle:#f8f8f8;--accent:#611f69;--error:#b31b1b}
@media(prefers-color-scheme:dark){:root{--surface:#1a1d21;--text:#d1d2d3;--muted:#ababad;--border:#797c8059;--subtle:#222529;--accent:#d9b9df;--error:#ffb0b0}}
*{box-sizing:border-box}body{margin:0;background:var(--surface);color:var(--text)}
form{height:100vh;display:flex;flex-direction:column}header{flex-shrink:0;padding:28px 28px 20px}h1{margin:0 0 10px;font-size:26px;line-height:1.25;letter-spacing:-.4px;font-weight:700}p{margin:0;color:var(--muted)}
.content{padding:0 28px 24px;flex:1;min-height:0;overflow-y:auto}label{display:block;margin-bottom:8px;font-weight:700}
textarea{display:block;width:100%;height:168px;min-height:120px;resize:vertical;padding:12px;border:1px solid var(--border);border-radius:4px;background:var(--surface);color:var(--text);font:13px/1.5 ui-monospace,SFMono-Regular,Consolas,monospace;transition:border-color .12s,box-shadow .12s}
textarea::placeholder{color:var(--muted);opacity:.7}textarea:focus{outline:none;border-color:#1264a3;box-shadow:0 0 0 1px #1264a3,0 0 0 4px #1264a326}
.hint{margin-top:10px;font-size:13px}.hint code{font:inherit;font-weight:700;color:var(--text)}
.note{display:flex;gap:9px;align-items:center;margin-top:20px;font-size:13px;color:var(--muted)}.note svg{flex:none;color:var(--accent)}
#status{margin-top:14px;color:var(--error);font-size:14px}#status:empty{display:none}
footer{flex-shrink:0;display:flex;gap:12px;justify-content:flex-end;padding:20px 28px;border-top:1px solid var(--border);background:var(--subtle)}
button{min-height:38px;padding:7px 18px;border:1px solid var(--border);border-radius:4px;background:var(--surface);color:var(--text);font:700 15px/1.4667 Slack-Lato,Arial,sans-serif;cursor:pointer;transition:background .12s}
button:hover{background:var(--subtle)}button:focus-visible{outline:2px solid #1264a3;outline-offset:3px}
.primary{min-width:108px;border-color:transparent;background:#007a5a;color:#fff}.primary:hover{background:#148567}.primary:disabled{background:var(--border);color:var(--muted);cursor:default}
</style></head><body><form>
<header><h1>Sign in with cookies</h1><p>This is useful if you like to sandbox your apps. Copy your Slack cookies here and Slick will use them to sign you in.</p></header>
<div class="content">
<textarea id="cookies" autofocus spellcheck="false" autocomplete="off" autocapitalize="off" aria-describedby="hint" placeholder="Paste your cookies here"></textarea>
<p class="hint" id="hint">Use a JSON export, a Cookie header, or your <code>d</code> cookie value. Include HttpOnly cookies when exporting.</p>
<p id="status" role="alert" aria-live="polite"></p></div>
<footer><button type="button" id="cancel">Cancel</button><button type="submit" class="primary" disabled>Sign in</button></footer></form>
<script>const form=document.querySelector('form'),text=document.querySelector('textarea'),button=document.querySelector('[type=submit]'),status=document.querySelector('#status');let submitting=false;
text.addEventListener('input',()=>{button.disabled=submitting||!text.value.trim();status.textContent='';text.removeAttribute('aria-invalid');});
document.querySelector('#cancel').addEventListener('click',()=>window.close());
document.addEventListener('keydown',event=>{if(event.key==='Escape')window.close();if(event.key==='Enter'&&(event.metaKey||event.ctrlKey)){event.preventDefault();form.requestSubmit();}});
form.addEventListener('submit',async event=>{event.preventDefault();if(submitting||!text.value.trim())return;submitting=true;button.disabled=true;button.textContent='Signing in…';status.textContent='';
try{const result=await window.slickCookieLogin.submit(text.value);if(result.ok){text.value='';window.close();}else{status.textContent=result.error;text.setAttribute('aria-invalid','true');}}
catch{status.textContent='Could not import cookies. Try again.';}finally{submitting=false;button.disabled=!text.value.trim();button.textContent='Sign in';}});</script></body></html>`;
}

export function createCookieLogin(
  preload: string,
  login: (target: Electron.WebContents, value: string) => Promise<void>,
) {
  let win: BrowserWindow | null = null;
  let target: Electron.WebContents | null = null;
  let busy = false;
  ipcMain.on('slick:open-cookie-login', (event) => {
    if (event.senderFrame !== event.sender.mainFrame) return;
    try {
      const url = new URL(event.senderFrame.url);
      if (url.protocol === 'https:' && (url.hostname === 'slack.com' || url.hostname.endsWith('.slack.com')))
        open(event.sender);
    } catch {}
  });
  ipcMain.handle('slick:cookie-login', async (event, value: unknown) => {
    if (
      !win ||
      win.isDestroyed() ||
      event.sender !== win.webContents ||
      event.senderFrame !== win.webContents.mainFrame
    )
      return { ok: false, error: 'This sign-in window is no longer available.' };
    if (busy) return { ok: false, error: 'Sign-in is already in progress.' };
    if (!target || target.isDestroyed()) return { ok: false, error: 'Reopen the Slack window, then try again.' };
    if (typeof value !== 'string') return { ok: false, error: 'Paste your Slack cookies.' };
    busy = true;
    try {
      await login(target, value);
      return { ok: true };
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : 'Could not import cookies.' };
    } finally {
      busy = false;
    }
  });
  function open(sender?: Electron.WebContents) {
    if (win && !win.isDestroyed()) {
      win.show();
      win.focus();
      return;
    }
    target =
      sender ??
      BrowserWindow.getAllWindows()
        .map((window) => window.webContents)
        .find((contents) => {
          try {
            const url = new URL(contents.getURL());
            return url.protocol === 'https:' && (url.hostname === 'slack.com' || url.hostname.endsWith('.slack.com'));
          } catch {
            return false;
          }
        }) ??
      null;
    if (!target) return;
    win = new BrowserWindow({
      title: 'Sign in with cookies',
      width: 540,
      height: 550,
      minWidth: 480,
      minHeight: 510,
      show: false,
      backgroundColor: nativeTheme.shouldUseDarkColors ? '#1a1d21' : '#ffffff',
      parent: BrowserWindow.fromWebContents(target) ?? undefined,
      autoHideMenuBar: true,
      webPreferences: {
        preload: path.resolve(preload),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        partition: 'slick-cookie-login',
      },
    });
    win.once('ready-to-show', () => win && !win.isDestroyed() && win.show());
    win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    win.webContents.on('will-navigate', (event) => event.preventDefault());
    win.on('closed', () => {
      win = null;
      target = null;
    });
    void win.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(cookieLoginHtml())}`);
  }
  return { open };
}
