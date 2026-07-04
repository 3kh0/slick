'use strict';

try {
  const fs = require('fs');
  const path = require('path');
  const { webFrame } = require('electron');
  const source = fs.readFileSync(path.join(__dirname, 'renderer.js'), 'utf8');
  webFrame.executeJavaScript(source, true).catch(() => {});
} catch {}
