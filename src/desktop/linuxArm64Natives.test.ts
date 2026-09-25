import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { linuxArm64NativePath, prepareLinuxArm64Natives, slackDesktopUtilsPrebuildUrl } from './linuxArm64Natives.ts';

test('ARM64 dlopen redirect preserves the omitted flags argument', () => {
  const original = process.dlopen;
  const calls: unknown[][] = [];
  try {
    process.dlopen = ((...args: unknown[]) => {
      calls.push(args);
    }) as typeof process.dlopen;
    prepareLinuxArm64Natives('/tmp/slack/app.asar', '/tmp/slick');
    const module = {};
    process.dlopen(module as NodeModule, '/tmp/other.node');
    process.dlopen(module as NodeModule, '/tmp/other.node', 2);
    assert.deepEqual(calls, [
      [module, '/tmp/other.node'],
      [module, '/tmp/other.node', 2],
    ]);
  } finally {
    process.dlopen = original;
  }
});

test('uses Slack package metadata to construct the highest N-API arm64 URL', () => {
  assert.equal(
    slackDesktopUtilsPrebuildUrl({
      version: '1.24.0',
      binary: {
        production_host: 'https://slack-desktop-native-prebuilds.s3.amazonaws.com',
        package_name: '{module_name}-v{version}-napi-v{napi_build_version}-{platform}-{arch}.tar.gz',
        module_name: 'slackdesktoputils',
        napi_versions: [3, 8, 7],
      },
    }),
    'https://slack-desktop-native-prebuilds.s3.amazonaws.com/slackdesktoputils-v1.24.0-napi-v8-linux-arm64.tar.gz',
  );
});

test('only maps Slack native paths and prefers the downloaded proprietary binary', () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'slick-arm64-test-'));
  try {
    const resources = path.join(dir, 'slack');
    const slick = path.join(dir, 'slick');
    const bundled = path.join(slick, 'native', 'linux-arm64');
    const downloaded = path.join(resources, 'arm64-native');
    mkdirSync(bundled, { recursive: true });
    mkdirSync(downloaded, { recursive: true });
    writeFileSync(path.join(bundled, 'keymapping.node'), '');
    writeFileSync(path.join(downloaded, 'slackdesktoputils.node'), '');
    const source = path.join(resources, 'app.asar.unpacked', 'node_modules');
    assert.equal(
      linuxArm64NativePath(
        path.join(source, '@tinyspeck/native-keymap/build/Release/keymapping.node'),
        resources,
        slick,
      ),
      path.join(bundled, 'keymapping.node'),
    );
    assert.equal(
      linuxArm64NativePath(
        path.join(source, '@tinyspeck/slack-desktop-utils/lib/binding/napi-v8/slackdesktoputils.node'),
        resources,
        slick,
      ),
      path.join(downloaded, 'slackdesktoputils.node'),
    );
    const missing = path.join(source, 'file-handler-info/build/Release/file_handler_info.node');
    assert.equal(linuxArm64NativePath(missing, resources, slick), missing);
    assert.equal(
      linuxArm64NativePath(path.join(dir, 'slack-other', 'app.asar.unpacked', 'keymapping.node'), resources, slick),
      path.join(dir, 'slack-other', 'app.asar.unpacked', 'keymapping.node'),
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
