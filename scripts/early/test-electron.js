'use strict';

const path = require('node:path');
const { spawnSync } = require('node:child_process');
const electron = require('../../byoe/node_modules/electron');
const result = spawnSync(electron, [path.join(__dirname, 'electron-fixture.js')], { stdio: 'inherit', timeout: 30000 });
if (result.error) console.error(result.error.message);
process.exitCode = result.status ?? 1;
