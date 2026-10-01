// UNNotificationSound searches the real executable's bundle, not our spoofed
// process.resourcesPath. Stage PCM CAF files before the bundle is signed.
import { execFile } from 'node:child_process';
import { mkdtemp, mkdir, readdir, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { macNotificationSoundName } from '../../src/desktop/macNotificationSounds.ts';

const exec = promisify(execFile);

/** CI has no installed Slack. Download only at build time, from Slack itself. */
async function downloadSoundResources(temporary: string): Promise<string> {
  const { stdout: url } = await exec('/usr/bin/curl', [
    '--fail',
    '--silent',
    '--show-error',
    '--location',
    '--head',
    '--output',
    '/dev/null',
    '--write-out',
    '%{url_effective}',
    'https://slack.com/ssb/download-osx-universal',
  ]);
  const version = /desktop-releases\/mac\/[^/]+\/(\d+\.\d+\.\d+)\//.exec(url)?.[1];
  if (!version) throw new Error('Could not determine the Slack version for notification sounds');
  const zip = path.join(temporary, 'Slack.zip');
  await exec('/usr/bin/curl', [
    '--fail',
    '--silent',
    '--show-error',
    '--location',
    '--output',
    zip,
    `https://downloads.slack-edge.com/desktop-releases/mac/arm64/${version}/Slack-${version}-macOS.zip`,
  ]);
  await exec('/usr/bin/unzip', ['-q', zip, 'Slack.app/Contents/Resources/*.mp3', '-d', temporary]);
  return path.join(temporary, 'Slack.app', 'Contents', 'Resources');
}

export async function prepareMacNotificationSounds(resources: string, output: string): Promise<void> {
  const temporary = await mkdtemp(path.join(os.tmpdir(), 'slick-sounds-'));
  try {
    const source = resources || (await downloadSoundResources(temporary));
    const sounds = (await readdir(source)).filter((name) => macNotificationSoundName(name));
    if (!sounds.length) throw new Error(`Slack has no notification sounds in ${source}`);
    await rm(output, { recursive: true, force: true });
    await mkdir(output, { recursive: true });
    for (const name of sounds) {
      await exec('/usr/bin/afconvert', [
        '-f',
        'caff',
        '-d',
        'LEI16',
        path.join(source, name),
        path.join(output, macNotificationSoundName(name)!),
      ]);
    }
    console.log(`[build:package] prepared ${sounds.length} macOS notification sounds`);
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
}
