import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { PLUGINS, SRC } from '../lib/paths.ts';
import { buildUserPlugin } from './plugin.ts';

const tmp = await mkdtemp(path.join(os.tmpdir(), 'slick-user-plugin-'));
test.after(() => rm(tmp, { recursive: true, force: true }));

async function fixture(name: string, files: Record<string, string>) {
  const dir = path.join(tmp, name);
  await mkdir(dir, { recursive: true });
  for (const [file, contents] of Object.entries(files)) await writeFile(path.join(dir, file), contents);
  return dir;
}

test('a repo plugin builds to one file that only imports $slick', async () => {
  const out = await buildUserPlugin(path.join(PLUGINS, 'HumanCount'), path.join(tmp, 'HumanCount.js'));
  const code = await readFile(out, 'utf8');
  assert.match(code, /require\("\$slick"\)/);
  assert.doesNotMatch(code, /src\/app\//);
  class SlickPlugin {
    start() {}
  }
  const module = { exports: {} as { default?: { id: string; prototype: object } } };
  new Function('module', 'exports', 'require', code)(module, module.exports, (name: string) => {
    assert.equal(name, '$slick');
    return { __esModule: true, SlickPlugin };
  });
  assert.equal(module.exports.default?.id, 'HumanCount');
  assert.ok(module.exports.default?.prototype instanceof SlickPlugin);
});

test("importing Slick's internals or shipping a main.ts fails the build", async () => {
  const internals = await fixture('Internals', {
    'index.ts': `import { SlickPlugin } from '$slick';
import { getExport } from ${JSON.stringify(path.join(SRC, 'app/slack/webpack.ts'))};
export default class Internals extends SlickPlugin { static id = 'Internals'; start() { getExport(() => true); } }`,
  });
  await assert.rejects(buildUserPlugin(internals, path.join(tmp, 'out.js')), /can only import \$slick/);

  const privileged = await fixture('Privileged', { 'index.ts': '', 'main.ts': '' });
  await assert.rejects(buildUserPlugin(privileged), /has a main\.ts/);
});
