import path from 'node:path';
import { BrowserWindow, ipcMain, nativeTheme, type WebContents } from 'electron';

const CHANNEL = 'slick-custom-css';
export const MONACO_VERSION = '0.56.0';
export const CSS_EDITOR_URL = 'slick://editor/index.html';
export const MONACO_URL_PREFIX = `/monaco-${MONACO_VERSION}/vs/`;

export function editorHtml(): string {
  const baseUrl = `slick://editor${MONACO_URL_PREFIX.slice(0, -1)}`;
  const base = JSON.stringify(baseUrl);
  return `<!doctype html>
<html>
<head>
  <meta charset="utf-8">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; font-src data:; worker-src blob:">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>Slick Custom CSS</title>
  <style>
    :root { color-scheme: light dark; font-family: system-ui, sans-serif; }
    html, body, #editor { width: 100%; height: 100%; margin: 0; overflow: hidden; }
    body { background: #fff; }
    #status { position: fixed; right: 14px; bottom: 10px; z-index: 2; padding: 3px 8px; border-radius: 5px; background: rgba(30,30,30,.75); color: #fff; font-size: 11px; pointer-events: none; opacity: 0; transition: opacity .15s; }
    #status.visible { opacity: 1; }
    @media (prefers-color-scheme: dark) { body { background: #1e1e1e; } }
  </style>
</head>
<body>
  <div id="editor"></div><div id="status" role="status" aria-live="polite"></div>
  <script src="${baseUrl}/loader.js"></script>
  <script>
    (() => {
      const base = ${base};
      const status = document.getElementById('status');
      let editor;
      let incoming = false;
      let saveTimer;
      let statusTimer;
      const showStatus = (text, sticky = false) => {
        clearTimeout(statusTimer);
        status.textContent = text;
        status.classList.add('visible');
        if (!sticky) statusTimer = setTimeout(() => status.classList.remove('visible'), 1400);
      };
      const save = () => {
        clearTimeout(saveTimer);
        if (!editor || incoming) return;
        window.slickCustomCss.save(editor.getValue());
        showStatus('Saved');
      };

      require.config({ paths: { vs: base } });
      require(['vs/editor/editor.main'], () => {
        editor = monaco.editor.create(document.getElementById('editor'), {
          value: '',
          language: 'css',
          automaticLayout: true,
          minimap: { enabled: false },
          fontSize: 13,
          insertSpaces: true,
          tabSize: 2,
          theme: matchMedia('(prefers-color-scheme: dark)').matches ? 'vs-dark' : 'vs',
          wordWrap: 'on',
        });
        editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, save);
        editor.onDidChangeModelContent(() => {
          if (incoming) return;
          clearTimeout(saveTimer);
          showStatus('Saving…', true);
          saveTimer = setTimeout(save, 300);
        });
        window.slickCustomCss.onValue((value) => {
          if (value === editor.getValue()) return;
          incoming = true;
          editor.setValue(value);
          incoming = false;
        });
        window.addEventListener('beforeunload', save);
        window.slickCustomCss.ready();
        editor.focus();
      }, (error) => {
        console.error('[slick-custom-css] Monaco failed to load', error);
        showStatus('Could not load Monaco. Reopen the editor to try again.', true);
      });
    })();
  </script>
</body>
</html>`;
}

type CssEditorOptions = {
  preload: string;
  read: () => Promise<string>;
  write: (css: string) => Promise<boolean>;
};

export function createCssEditor({ preload, read, write }: CssEditorOptions) {
  let win: BrowserWindow | null = null;

  const owns = (sender: WebContents) => !!win && !win.isDestroyed() && sender === win.webContents;
  ipcMain.on(`${CHANNEL}:ready`, (event) => {
    if (!owns(event.sender)) return;
    void read().then((css) => {
      if (owns(event.sender)) event.sender.send(`${CHANNEL}:value`, css);
    });
  });
  ipcMain.on(`${CHANNEL}:save`, (event, css: unknown) => {
    if (!owns(event.sender) || typeof css !== 'string') return;
    void write(css);
  });

  function open(): boolean {
    if (win && !win.isDestroyed()) {
      if (win.isMinimized()) win.restore();
      win.show();
      win.focus();
      return true;
    }

    try {
      win = new BrowserWindow({
        title: 'Slick Custom CSS',
        width: 900,
        height: 650,
        minWidth: 560,
        minHeight: 360,
        show: false,
        autoHideMenuBar: true,
        backgroundColor: nativeTheme.shouldUseDarkColors ? '#1e1e1e' : '#ffffff',
        webPreferences: {
          preload: path.resolve(preload),
          contextIsolation: true,
          nodeIntegration: false,
          sandbox: true,
        },
      });
      win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
      win.once('ready-to-show', () => win && !win.isDestroyed() && win.show());
      win.on('closed', () => {
        win = null;
      });
      void win.loadURL(CSS_EDITOR_URL).catch((error: unknown) => {
        console.error('[slick-custom-css] editor failed to open:', error);
      });
      return true;
    } catch (error) {
      console.error('[slick-custom-css] editor failed to open:', error);
      win = null;
      return false;
    }
  }

  function update(css: string) {
    if (win && !win.isDestroyed()) win.webContents.send(`${CHANNEL}:value`, css);
  }

  return { open, update };
}
