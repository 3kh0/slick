// Validate the actual distributable archives, including cross-browser parity.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { unzipSync } from 'fflate';

const archives = await Promise.all(
  ['slick-firefox.xpi', 'slick-chromium.zip'].map(async (name) => {
    const entries = unzipSync(await readFile(`dist/extension/${name}`));
    const manifest = JSON.parse(Buffer.from(entries['manifest.json']).toString());
    assert.equal(manifest.manifest_version, 3);
    assert.match(manifest.version, /^\d+\.\d+\.\d+$/);
    assert.deepEqual(manifest.permissions, ['storage', 'scripting', 'declarativeNetRequest']);
    assert.deepEqual(manifest.host_permissions, ['https://app.slack.com/*']);
    assert.deepEqual(manifest.optional_permissions, ['cookies', 'browsingData']);
    assert.deepEqual(manifest.optional_host_permissions, ['https://*.slack.com/*']);
    assert.equal(manifest.content_security_policy.extension_pages, "script-src 'self'; object-src 'none'");
    const scripts = manifest.content_scripts.flatMap((entry: { js: string[] }) => entry.js);
    for (const file of [
      ...scripts,
      'background.js',
      'options.html',
      'options.css',
      'options.js',
      'accounts.html',
      'accounts-ui.js',
      'accounts-paused.html',
      'accounts.css',
      'licenses/HaikuWarning/DICTIONARY-NOTICE.txt',
      'licenses/HaikuWarning/CMUDICT-LICENSE.txt',
      ...Object.values(manifest.icons),
    ]) {
      assert.ok(typeof file === 'string' && entries[file]?.length, `${name}: missing ${String(file)}`);
    }
    for (const file of Object.values(manifest.action.default_icon) as string[]) assert.ok(entries[file]?.length);
    for (const file of [
      'icons/16.png',
      'icons/32.png',
      'icons/128.png',
      ...(name.endsWith('.zip') ? ['icons/black.png', 'icons/white.png'] : []),
    ]) {
      assert.equal(Buffer.from(entries[file].subarray(0, 8)).toString('hex'), '89504e470d0a1a0a');
    }
    assert.ok(!Object.keys(entries).some((file) => file.startsWith('/') || file.split('/').includes('..')));
    if (name.endsWith('.zip')) {
      assert.deepEqual(manifest.background, { service_worker: 'background.js' });
      assert.equal(manifest.browser_specific_settings, undefined);
      assert.equal(manifest.update_url, undefined);
      assert.equal(manifest.action.theme_icons, undefined);
      assert.equal(manifest.minimum_chrome_version, '111');
    } else assert.deepEqual(manifest.background, { scripts: ['background.js'] });
    console.log(`PASS: ${name}: MV3 manifest, permissions and packaged assets`);
    return { entries, manifest };
  }),
);
assert.deepEqual(archives[0].entries['page.js'], archives[1].entries['page.js']);
assert.deepEqual(archives[0].manifest.content_scripts, archives[1].manifest.content_scripts);
console.log('PASS: Firefox and Chromium ship identical page/plugin code and injection declarations');
