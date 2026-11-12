import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { build } from 'esbuild';

const bundle = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'slick-finder-test-')), 'slackFinder.mjs');
const shims: Record<string, string> = {
  './paths.js': `export const settingsDir = () => '';`,
  './linuxArm64Slack.js': `export const downloadedSlackResources = () => '';`,
};
await build({
  entryPoints: [new URL('./slackFinder.ts', import.meta.url).pathname],
  outfile: bundle,
  bundle: true,
  platform: 'node',
  format: 'esm',
  plugins: [
    {
      name: 'finder-fixture',
      setup(builder) {
        builder.onResolve({ filter: /.*/ }, (args) =>
          Object.hasOwn(shims, args.path) ? { path: args.path, namespace: 'fixture' } : undefined,
        );
        builder.onLoad({ filter: /.*/, namespace: 'fixture' }, (args) => ({
          contents: shims[args.path],
          loader: 'js',
        }));
      },
    },
  ],
});
const { pickSlackResources, slackInstallKind, slackDownloadUrl } = await import(bundle);

test('WindowsApps identifies the package format without assuming a Store install', (t) => {
  const override = process.env.SLICK_SLACK_RESOURCES;
  delete process.env.SLICK_SLACK_RESOURCES;
  t.after(() => {
    if (override === undefined) delete process.env.SLICK_SLACK_RESOURCES;
    else process.env.SLICK_SLACK_RESOURCES = override;
  });

  for (const arch of ['x64', 'arm64']) {
    const asar = `C:\\Program Files\\WindowsApps\\com.tinyspeck.slackdesktop_4.53.287.0_${arch}__8yrtsj140pw4g\\app\\resources\\app.asar`;
    assert.equal(slackInstallKind(asar), 'msix');
    assert.equal(slackInstallKind(asar.replaceAll('\\', '/')), 'msix');
  }
});

test('update destinations offer direct downloads on each platform', () => {
  assert.equal(slackDownloadUrl('win32'), 'https://slack.com/downloads/windows');
  assert.equal(slackDownloadUrl('darwin'), 'https://slack.com/downloads/mac');
  assert.equal(slackDownloadUrl('linux'), 'https://slack.com/downloads/linux');
});

const installs = {
  oldSquirrel: { arch: 'x64', electronMajor: 43 },
  store: { arch: 'x64', electronMajor: 44 },
  armStore: { arch: 'arm64', electronMajor: 44 },
};
const probe = {
  arch: (resources: string) => installs[resources as keyof typeof installs]?.arch ?? '',
  electronMajor: (resources: string) => installs[resources as keyof typeof installs]?.electronMajor ?? 0,
};

test('prefers the install whose Electron major matches Slick', () => {
  assert.equal(
    pickSlackResources(['oldSquirrel', 'store'], probe, {
      arch: 'x64',
      electronMajor: 44,
    }),
    'store',
  );
});

test('never trades arch for an Electron match', () => {
  assert.equal(
    pickSlackResources(['oldSquirrel', 'armStore'], probe, {
      arch: 'x64',
      electronMajor: 44,
    }),
    'oldSquirrel',
  );
});

test('falls back to the first candidate when nothing matches', () => {
  assert.equal(
    pickSlackResources(['unknown', 'other'], probe, {
      arch: 'x64',
      electronMajor: 44,
    }),
    'unknown',
  );
  assert.equal(pickSlackResources([], probe), '');
});
