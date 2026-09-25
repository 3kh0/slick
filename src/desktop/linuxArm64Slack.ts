import fs from 'node:fs';
import { createReadStream, createWriteStream } from 'node:fs';
import { mkdir, readdir, rename, rm } from 'node:fs/promises';
import path from 'node:path';
import { Readable } from 'node:stream';
import { createGunzip } from 'node:zlib';
import tar from 'tar-stream';
import xz from 'xz-decompress';
import { pipeline } from 'node:stream/promises';
import { net } from 'electron';
import { settingsDir } from './paths.js';
import { slackDesktopUtilsPrebuildUrl } from './linuxArm64Natives.js';

export const LINUX_ARM64_SLACK_VERSION = '4.52.155';
const root = () => path.join(settingsDir(), 'linux-arm64-slack');
export const downloadedSlackResources = () => path.join(root(), LINUX_ARM64_SLACK_VERSION);

async function download(url: string, dest: string): Promise<void> {
  const response = await net.fetch(url);
  if (!response.ok || !response.body) throw new Error(`${url}: HTTP ${response.status}`);
  await pipeline(Readable.fromWeb(response.body as never), createWriteStream(dest));
}

async function debDataMember(deb: string): Promise<{ start: number; end: number }> {
  const file = await fs.promises.open(deb);
  try {
    const magic = Buffer.alloc(8);
    await file.read(magic, 0, 8, 0);
    if (magic.toString() !== '!<arch>\n') throw new Error('invalid Slack deb archive');
    const header = Buffer.alloc(60);
    let offset = 8;
    for (;;) {
      const { bytesRead } = await file.read(header, 0, 60, offset);
      if (bytesRead !== 60) throw new Error('Slack deb has no data.tar.xz');
      const name = header.toString('ascii', 0, 16).trim().replace(/\/$/, '');
      const size = Number(header.toString('ascii', 48, 58).trim());
      if (!Number.isSafeInteger(size) || size < 0) throw new Error('invalid Slack deb member size');
      if (name === 'data.tar.xz') return { start: offset + 60, end: offset + 60 + size - 1 };
      offset += 60 + size + (size % 2);
    }
  } finally {
    await file.close();
  }
}

async function unpackTar(stream: NodeJS.ReadableStream, into: string, prefix: string): Promise<void> {
  const extract = tar.extract();
  extract.on('entry', (header, entry, next) => {
    const name = header.name.replace(/^\.\//, '');
    if (header.type !== 'file' || !name.startsWith(prefix)) {
      entry.resume();
      entry.on('end', next);
      return;
    }
    const relative = name.slice(prefix.length);
    if (!relative || relative.split('/').includes('..')) {
      extract.destroy(new Error('unsafe Slack archive entry'));
      return;
    }
    const dest = path.join(into, relative === 'app.asar' ? 'app.asar.download' : relative);
    mkdir(path.dirname(dest), { recursive: true })
      .then(() => pipeline(entry, createWriteStream(dest)))
      .then(
        () => next(),
        (error) => extract.destroy(error),
      );
  });
  await pipeline(stream, extract);
}

async function unpackDeb(archive: string, into: string): Promise<void> {
  const { start, end } = await debDataMember(archive);
  const compressed = Readable.toWeb(createReadStream(archive, { start, end })) as ReadableStream<Uint8Array>;
  const plain = new xz.XzReadableStream(compressed);
  await unpackTar(Readable.fromWeb(plain as never), into, 'usr/lib/slack/resources/');
}

async function downloadNative(resources: string): Promise<void> {
  const manifest = JSON.parse(
    fs.readFileSync(
      path.join(resources, 'app.asar', 'node_modules', '@tinyspeck', 'slack-desktop-utils', 'package.json'),
      'utf8',
    ),
  );
  const url = slackDesktopUtilsPrebuildUrl(manifest);
  console.log(`[slick] downloading arm64 slack-desktop-utils from ${url}`);
  const archive = path.join(path.dirname(resources), 'native.tar.gz');
  const extracted = path.join(path.dirname(resources), 'native-extract');
  await mkdir(extracted, { recursive: true });
  await download(url, archive);
  await unpackTar(createReadStream(archive).pipe(createGunzip()), extracted, '');
  const find = async (dir: string): Promise<string> => {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      const file = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        const result = await find(file);
        if (result) return result;
      } else if (entry.name === 'slackdesktoputils.node') return file;
    }
    return '';
  };
  const binary = await find(extracted);
  if (!binary) throw new Error('Slack arm64 prebuild has no slackdesktoputils.node');
  const dest = path.join(resources, 'arm64-native');
  await mkdir(dest);
  await fs.promises.copyFile(binary, path.join(dest, 'slackdesktoputils.node'));
}

export async function downloadLinuxArm64Slack(): Promise<string> {
  const target = downloadedSlackResources();
  if (fs.existsSync(path.join(target, 'app.asar'))) return target;
  const base = root();
  const stage = path.join(base, `${LINUX_ARM64_SLACK_VERSION}.partial-${process.pid}`);
  const archive = path.join(stage, 'slack.deb');
  const resources = path.join(stage, 'resources');
  await mkdir(resources, { recursive: true });
  try {
    const version = LINUX_ARM64_SLACK_VERSION;
    const url = `https://downloads.slack-edge.com/desktop-releases/linux/x64/${version}/slack-desktop-${version}-amd64.deb`;
    console.log(`[slick] downloading Slack ${version} from ${url}`);
    await download(url, archive);
    await unpackDeb(archive, resources);
    const stagedAsar = path.join(resources, 'app.asar.download');
    if (!fs.existsSync(stagedAsar)) throw new Error('Slack download has no app.asar');
    await rename(stagedAsar, path.join(resources, 'app.asar'));
    await downloadNative(resources).catch((error) =>
      console.warn('[slick] arm64 slack-desktop-utils unavailable:', error),
    );
    await rm(archive, { force: true });
    await rm(path.join(stage, 'native.tar.gz'), { force: true });
    await rm(path.join(stage, 'native-extract'), { recursive: true, force: true });
    await rename(resources, target);
    await fs.promises.writeFile(path.join(base, 'version'), '44.0.0');
    for (const name of await readdir(base)) {
      if (name !== version && name !== 'version' && !name.endsWith(`partial-${process.pid}`)) {
        await rm(path.join(base, name), { recursive: true, force: true }).catch(() => {});
      }
    }
    return target;
  } finally {
    await rm(stage, { recursive: true, force: true });
  }
}
