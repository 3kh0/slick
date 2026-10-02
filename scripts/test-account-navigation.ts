// Run the account isolation proof in a disposable Electron profile, never Slack's.
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { build } from 'esbuild';

const directory = await mkdtemp(path.join(tmpdir(), 'slick-account-proof-'));
try {
  const module = path.join(directory, 'navigation.cjs');
  await build({
    entryPoints: ['src/desktop/accountNavigation.ts'],
    bundle: true,
    platform: 'node',
    format: 'cjs',
    outfile: module,
  });
  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;
  env.ACCOUNT_NAV_MODULE = module;
  env.ACCOUNT_NAV_PROFILE = path.join(directory, 'profile');
  const executable = createRequire(import.meta.url)('electron') as string;
  const child = spawn(executable, ['src/desktop/accountNavigation.electron.cjs'], { env, stdio: 'inherit' });
  process.exitCode = await new Promise<number>((resolve, reject) => {
    child.once('error', reject);
    child.once('exit', (code) => resolve(code ?? 1));
  });
} finally {
  await rm(directory, { recursive: true, force: true });
}
