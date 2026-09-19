'use strict';

const path = require('path');

const CHANNEL = 'slick-custom-css';
const MONACO_VERSION = '0.56.0';
const MONACO_ROOT = `https://cdn.jsdelivr.net/npm/monaco-editor@${MONACO_VERSION}/min`;
const MONACO_BASE = `${MONACO_ROOT}/vs`;

function editorHtml() {
  const base = JSON.stringify(MONACO_BASE);
  const root = JSON.stringify(MONACO_ROOT);
  return `<!doctype html>
<html>
<head>
  <meta charset="utf-8">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline' https://cdn.jsdelivr.net; style-src 'unsafe-inline' https://cdn.jsdelivr.net; font-src https://cdn.jsdelivr.net; worker-src blob: data:; connect-src https://cdn.jsdelivr.net">
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
  <script src="${MONACO_BASE}/loader.js"></script>
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

      self.MonacoEnvironment = {
        getWorkerUrl() {
          const root = ${root};
          const source = "self.MonacoEnvironment={baseUrl:'" + root + "/'};importScripts('" + base + "/base/worker/workerMain.js');";
          return 'data:text/javascript;charset=utf-8,' + encodeURIComponent(source);
        },
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
        showStatus('Could not load Monaco. Check your connection and reopen the editor.', true);
      });
    })();
  </script>
</body>
</html>`;
}

function createCustomCssWindow({ electron, read, write }) {
  const { BrowserWindow, ipcMain } = electron;
  let win = null;

  const owns = (event) => win && !win.isDestroyed() && event.sender === win.webContents;
  ipcMain.on(`${CHANNEL}:ready`, (event) => {
    if (owns(event)) event.sender.send(`${CHANNEL}:value`, read());
  });
  ipcMain.on(`${CHANNEL}:save`, (event, css) => {
    if (!owns(event) || typeof css !== 'string') return;
    write(css);
  });

  function open() {
    if (win && !win.isDestroyed()) {
      if (win.isMinimized()) win.restore();
      win.show();
      win.focus();
      return;
    }
    win = new BrowserWindow({
      title: 'Slick Custom CSS',
      width: 900,
      height: 650,
      minWidth: 560,
      minHeight: 360,
      show: false,
      autoHideMenuBar: true,
      backgroundColor: electron.nativeTheme.shouldUseDarkColors ? '#1e1e1e' : '#ffffff',
      webPreferences: {
        preload: path.join(__dirname, 'custom-css-preload.js'),
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
    win.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(editorHtml())}`).catch((error) => {
      console.error('[slick-custom-css] editor failed to open:', error.message);
    });
  }

  function update(css) {
    if (win && !win.isDestroyed()) win.webContents.send(`${CHANNEL}:value`, css || '');
  }

  return { open, update };
}

module.exports = { createCustomCssWindow, editorHtml };
