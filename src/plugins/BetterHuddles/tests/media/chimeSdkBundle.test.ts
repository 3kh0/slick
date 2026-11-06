// Bundles media/chimeSdk.ts the way Slick's builds do and checks each export is
// the real class / enum. Slick's package is `"type": "module"`, so esbuild gives
// a CommonJS file's whole `module.exports` as its default import; without
// unwrapping, `new DefaultMeetingSession(...)` failed with "is not a constructor".
import assert from 'node:assert/strict';
import path from 'node:path';
import { describe, it } from 'node:test';
import vm from 'node:vm';
import { build } from 'esbuild';
import { slickSharedAlias } from '../../../../../scripts/lib/plugin.ts';

const MEDIA = path.join(import.meta.dirname, '..', '..', 'media');

/** Bundles `import * as sdk from <specifier>` like Slick's builds, runs it in a browser-like sandbox (no Node `global`). */
async function bundledExports(specifier: string, sandbox: Record<string, unknown> = {}): Promise<Record<string, any>> {
  const result = await build({
    stdin: {
      contents: `import * as sdk from ${JSON.stringify(specifier)}; globalThis.result = sdk;`,
      resolveDir: MEDIA,
    },
    bundle: true,
    write: false,
    platform: 'browser',
    format: 'iife',
    target: 'es2022',
    plugins: [slickSharedAlias],
    define: { process: 'undefined' },
    logLevel: 'silent',
  });
  const context = vm.createContext({ console, ...sandbox });
  vm.runInContext(result.outputFiles[0].text, context);
  return context.result;
}

const CLASSES = [
  'DefaultBrowserBehavior',
  'DefaultDeviceController',
  'DefaultEventController',
  'NoOpEventReporter',
  'DefaultMeetingSession',
  'MeetingSessionConfiguration',
  'VideoCodecCapability',
  'VideoPreference',
  'VideoPreferences',
  'VideoPriorityBasedPolicy',
  'VideoPriorityBasedPolicyConfig',
];

describe('chimeSdk bundle', () => {
  it('exports the SDK classes themselves, not their CommonJS module objects', async () => {
    const sdk = await bundledExports(path.join(MEDIA, 'chimeSdk.ts'));
    for (const name of CLASSES) {
      assert.equal(typeof sdk[name], 'function', `${name} should be a constructor`);
      // esbuild may rename a bundled class (`DefaultMeetingSession2`), but keeps its name in it.
      assert.ok(sdk[name].name.includes(name), `${name} should be the class, not a wrapper`);
    }
  });

  it('exports the enums with their members', async () => {
    const sdk = await bundledExports(path.join(MEDIA, 'chimeSdk.ts'));
    assert.equal(typeof sdk.MeetingSessionStatusCode.MeetingEnded, 'number');
  });

  it('gives the SDK index shim the real MeetingSessionStatus class', async () => {
    const shim = await bundledExports(path.join(MEDIA, 'chimeIndexShim.ts'));
    assert.equal(typeof shim.MeetingSessionStatus, 'function');
    assert.ok(shim.MeetingSessionStatus.name.includes('MeetingSessionStatus'));
    assert.equal(typeof shim.MeetingSessionStatusCode.Left, 'number');
  });

  it('runs the SDK\'s `"document" in global` checks without a Node `global` (and without adding one)', async () => {
    const listeners: string[] = [];
    const document = { addEventListener: (type: string) => listeners.push(type), removeEventListener: () => {} };
    const sandbox: Record<string, unknown> = { document };
    const cspMonitor = await bundledExports('amazon-chime-sdk-js/build/cspmonitor/CSPMonitor.js', sandbox);
    const CSPMonitor = cspMonitor.default.default ?? cspMonitor.default;
    assert.doesNotThrow(() => CSPMonitor.register());
    assert.deepEqual(listeners, ['securitypolicyviolation']);
    assert.equal('global' in sandbox, false);
  });
});
