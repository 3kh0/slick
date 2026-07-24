'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { analyze } = require('../perf/analyze');
const { configureVariant, removeCaches } = require('../perf/benchmark');
const { redactString, rendererProbeSource, sanitize } = require('../byoe/diagnostics');
const settings = require('../byoe/settings-ui');
const { loadPlugins } = require('../byoe/plugins');

test('diagnostic exports remove identifiers, secrets, and content fields', () => {
  const input = {
    url: 'https://app.slack.com/client/T1234567890/C1234567890?token=xoxb-secret-value',
    message: 'private message',
    customCss: 'body { display: none }',
    domContentLoadedMs: 123,
    nested: { userId: 'U1234567890', safe: true },
  };
  const output = sanitize(input);
  assert.equal(output.message, undefined);
  assert.equal(output.customCss, undefined);
  assert.equal(output.nested.safe, true);
  assert.equal(output.domContentLoadedMs, 123);
  assert.match(output.url, /^https:\/\/app\.slack\.com\/\[redacted\]$/);
  assert.doesNotMatch(JSON.stringify(output), /T123|C123|U123|xoxb|private message/);
  assert.equal(redactString('Bearer secret'), '[redacted-token]');
});

test('renderer performance probe is valid JavaScript', () => {
  assert.doesNotThrow(() => new Function(rendererProbeSource(true)));
});

test('diagnostic control invokes the local export callback', async () => {
  let exports = 0;
  const handled = settings.handleControl('https://slick.control/?op=diagnostics', {
    catalog: { plugins: [], themes: [] },
    onDiagnostics: async () => exports++,
  });
  assert.equal(handled, true);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(exports, 1);
});

test('plugin renderer sources retain their plugin attribution', () => {
  const result = loadPlugins({
    catalog: {
      plugins: [
        {
          dir: 'Example',
          mod: { meta: { name: 'Example' }, renderer: 'window.example = true' },
          schema: [],
        },
      ],
    },
    enabled: ['Example'],
    electron: { app: {} },
    settings: {},
  });
  assert.equal(result.js.at(-1).name, 'Example');
  assert.match(result.js.at(-1).source, /window\.example/);
});

test('advisory analysis requires relative and absolute startup regressions', () => {
  const runs = [
    { variant: 'stock', cold: false, startupMs: 1000, interactions: [], processSamples: [] },
    { variant: 'stock', cold: false, startupMs: 1100, interactions: [], processSamples: [] },
    { variant: 'core', cold: false, startupMs: 1400, interactions: [], processSamples: [] },
    { variant: 'core', cold: false, startupMs: 1500, interactions: [], processSamples: [] },
  ];
  const report = analyze({ runs });
  assert.equal(report.advisory, true);
  assert.equal(report.comparisons['core:warm'].pass, false);
  assert.match(report.comparisons['core:warm'].failures.join(' '), /startup p50/);
});

test('analysis preserves plugin variants containing colons', () => {
  const report = analyze({
    runs: [
      { variant: 'stock', cold: false, startupMs: 1000, interactions: [], processSamples: [] },
      { variant: 'plugin:MessageLogger', cold: false, startupMs: 1100, interactions: [], processSamples: [] },
    ],
  });
  assert.ok(report.comparisons['plugin:MessageLogger:warm']);
});

test('release qualification compares platforms independently and requires all three', () => {
  const report = analyze(
    {
      runs: [
        {
          platform: 'darwin',
          arch: 'arm64',
          variant: 'stock',
          cold: false,
          startupMs: 1000,
          interactions: [],
          processSamples: [],
        },
        {
          platform: 'darwin',
          arch: 'arm64',
          variant: 'core',
          cold: false,
          startupMs: 1100,
          interactions: [],
          processSamples: [],
        },
      ],
    },
    { enforce: true },
  );
  assert.ok(report.comparisons['darwin/arm64|core:warm']);
  assert.equal(report.advisory, false);
  assert.equal(report.qualification.releaseReady, false);
  assert.deepEqual(report.qualification.missingPlatforms, ['linux/x64', 'win32/x64']);
});

test('benchmark variants and cold-cache cleanup stay inside the disposable profile', () => {
  const parent = fs.mkdtempSync(path.join(os.tmpdir(), 'slick-perf-test-'));
  const profile = path.join(parent, 'profile');
  const outside = path.join(parent, 'outside');
  fs.mkdirSync(path.join(profile, 'Default', 'Cache'), { recursive: true });
  fs.mkdirSync(path.join(outside, 'Cache'), { recursive: true });
  fs.writeFileSync(path.join(profile, 'Default', 'Cache', 'inside'), 'inside');
  fs.writeFileSync(path.join(outside, 'Cache', 'outside'), 'outside');
  try {
    assert.deepEqual(configureVariant(profile, 'defaults'), ['NoTrack', 'Snappy']);
    removeCaches(profile);
    assert.equal(fs.existsSync(path.join(profile, 'Default', 'Cache')), false);
    assert.equal(fs.readFileSync(path.join(outside, 'Cache', 'outside'), 'utf8'), 'outside');
    assert.deepEqual(JSON.parse(fs.readFileSync(path.join(profile, 'slick', 'enabled-plugins.json'))), [
      'NoTrack',
      'Snappy',
    ]);
  } finally {
    fs.rmSync(parent, { recursive: true, force: true });
  }
});
