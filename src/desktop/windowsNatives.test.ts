import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { prepareWindowsNatives } from './windowsNatives.ts';

test('mirrors each Slack install even when its Electron version is unchanged', () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'slick-windows-native-test-'));
  const originalDlopen = process.dlopen;
  const originalPath = process.env.PATH;
  const originalProfile = process.env.SLICK_HANDOFF_PROFILE;
  const calls: unknown[][] = [];
  try {
    process.env.SLICK_HANDOFF_PROFILE = path.join(dir, 'profile');
    const createInstall = (name: string, contents: string) => {
      const appDir = path.join(dir, name, 'app');
      const resources = path.join(appDir, 'resources');
      const addon = path.join(resources, 'app.asar.unpacked', 'node_modules', 'addon.node');
      mkdirSync(path.dirname(addon), { recursive: true });
      writeFileSync(path.join(appDir, 'version'), '44.3.0');
      writeFileSync(addon, contents);
      return { asar: path.join(resources, 'app.asar'), addon };
    };
    const first = createInstall('Slack_4.52.155', 'old');
    const second = createInstall('Slack_4.52.162', 'new');
    process.dlopen = ((...args: unknown[]) => {
      calls.push(args);
    }) as typeof process.dlopen;

    assert.equal(prepareWindowsNatives(first.asar), true);
    const module = {} as NodeModule;
    process.dlopen(module, first.addon);
    const firstMirror = calls.at(-1)?.[1] as string;
    assert.equal(readFileSync(firstMirror, 'utf8'), 'old');
    assert.equal(prepareWindowsNatives(first.asar), false);

    assert.equal(prepareWindowsNatives(second.asar), true);
    process.dlopen(module, second.addon, 2);
    const secondMirror = calls.at(-1)?.[1] as string;
    assert.notEqual(secondMirror, firstMirror);
    assert.equal(readFileSync(secondMirror, 'utf8'), 'new');
    assert.deepEqual(calls.at(-2), [module, firstMirror]);
    assert.deepEqual(calls.at(-1), [module, secondMirror, 2]);
  } finally {
    process.dlopen = originalDlopen;
    if (originalPath === undefined) delete process.env.PATH;
    else process.env.PATH = originalPath;
    if (originalProfile === undefined) delete process.env.SLICK_HANDOFF_PROFILE;
    else process.env.SLICK_HANDOFF_PROFILE = originalProfile;
    rmSync(dir, { recursive: true, force: true });
  }
});
