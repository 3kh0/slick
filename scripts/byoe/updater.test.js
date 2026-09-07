'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { EventEmitter } = require('node:events');
const test = require('node:test');

const source = fs.readFileSync(path.join(__dirname, 'updater.js'), 'utf8');

function loadUpdater({ beta = false, build = 42 } = {}) {
  const calls = { markers: [], dialogs: [], timers: [], requests: [], writes: [], ready: 0 };
  const root = path.resolve('/virtual/slick');
  const unexpected = () => assert.fail('Unexpected updater side effect');
  const mocks = {
    fs: {
      existsSync(file) {
        calls.markers.push(file);
        return beta && file === path.join(root, '.slick-beta');
      },
      readFileSync: () => '{}',
      mkdirSync: () => {},
      writeFileSync: (...args) => calls.writes.push(args),
      mkdtempSync: unexpected,
      createWriteStream: unexpected,
    },
    https: {
      get(url, options, callback) {
        calls.requests.push(url);
        const request = new EventEmitter();
        request.setTimeout = () => {};
        queueMicrotask(() => {
          const response = new EventEmitter();
          response.statusCode = 200;
          response.setEncoding = () => {};
          callback(response);
          response.emit('data', JSON.stringify({ tag_name: 'v42' }));
          response.emit('end');
        });
        return request;
      },
    },
    child_process: { execFile: unexpected, spawn: unexpected },
    electron: {
      app: {
        whenReady() {
          calls.ready += 1;
          return Promise.resolve();
        },
        quit: unexpected,
        getPath: unexpected,
      },
      dialog: {
        showMessageBox(options) {
          calls.dialogs.push(options);
          return Promise.resolve({ response: 0 });
        },
      },
      shell: { openExternal: unexpected },
      BrowserWindow: unexpected,
    },
  };
  const context = {
    module: { exports: {} },
    __dirname: path.join(root, 'scripts', 'byoe'),
    process,
    Buffer,
    setTimeout: (...args) => calls.timers.push(args),
    require: (name) => {
      if (Object.hasOwn(mocks, name)) return mocks[name];
      assert.ok(['path', 'crypto'].includes(name));
      return require(name);
    },
  };
  vm.runInNewContext(source, context, { filename: 'updater.js' });
  const api = context.module.exports.create({ version: '1.0', build, profile: '/virtual/profile' });
  return { api, calls, root };
}

for (const build of [0, 42]) {
  test(`beta build ${build} disables scheduling and reports manual management without side effects`, async () => {
    const { api, calls, root } = loadUpdater({ beta: true, build });
    api.scheduleUpdateChecks();
    const quiet = await api.manualCheckForUpdates({ quiet: true });
    assert.equal(quiet.state, 'unsupported');
    assert.match(quiet.message, /Beta.*manually/);
    assert.match(quiet.message, /installer with --beta/);
    assert.match(quiet.message, /automatic updates are disabled/);
    assert.equal(calls.dialogs.length, 0);
    const manual = await api.manualCheckForUpdates();
    assert.equal(manual.state, quiet.state);
    assert.equal(manual.message, quiet.message);
    assert.equal(calls.dialogs.length, 1);
    assert.equal(calls.dialogs[0].detail, quiet.message);
    assert.deepEqual(calls.markers, [path.join(root, '.slick-beta')]);
    assert.equal(calls.ready, 0);
    assert.equal(calls.timers.length, 0);
    assert.equal(calls.requests.length, 0);
    assert.equal(calls.writes.length, 0);
  });
}

test('unmarked development builds retain their existing unsupported status', async () => {
  const { api, calls } = loadUpdater({ build: 0 });
  api.scheduleUpdateChecks();
  const status = await api.manualCheckForUpdates({ quiet: true });
  assert.equal(status.state, 'unsupported');
  assert.match(status.message, /development build/);
  assert.equal(calls.timers.length, 0);
  assert.equal(calls.requests.length, 0);
});

test('unmarked release builds still schedule and check stable releases', async () => {
  const { api, calls } = loadUpdater();
  api.scheduleUpdateChecks();
  const status = await api.manualCheckForUpdates({ quiet: true });
  assert.equal(status.state, 'latest');
  assert.equal(calls.ready, 1);
  assert.equal(calls.timers.length, 1);
  assert.equal(calls.timers[0][1], 30000);
  assert.deepEqual(calls.requests, ['https://api.github.com/repos/3kh0/slick/releases/latest']);
  assert.equal(calls.writes.length, 1);
  assert.equal(calls.dialogs.length, 0);
});
