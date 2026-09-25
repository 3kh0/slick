import fs from 'node:fs';
import path from 'node:path';

const replacements: Record<string, string> = {
  'node_modules/@tinyspeck/native-keymap/build/Release/keymapping.node': 'keymapping.node',
  'node_modules/@tinyspeck/slack-desktop-utils/lib/binding/napi-v8/slackdesktoputils.node': 'slackdesktoputils.node',
  'node_modules/electron-native-auth/build/Release/electron_native_auth.node': 'electron_native_auth.node',
  'node_modules/file-handler-info/build/Release/file_handler_info.node': 'file_handler_info.node',
};

export function prepareLinuxArm64Natives(asar: string, slickResources: string): void {
  const dlopen = process.dlopen;
  process.dlopen = function slickDlopen(this: unknown, module: object, filename: string, flags?: number) {
    const mapped = linuxArm64NativePath(filename, path.dirname(asar), slickResources);
    return flags === undefined ? dlopen.call(this, module, mapped) : dlopen.call(this, module, mapped, flags);
  } as typeof process.dlopen;
}

export function linuxArm64NativePath(filename: string, resources: string, slickResources: string): string {
  const source = path.resolve(resources, 'app.asar.unpacked') + path.sep;
  const resolved = path.resolve(filename);
  if (!resolved.startsWith(source)) return filename;
  const relative = resolved.slice(source.length).split(path.sep).join('/');
  const name = replacements[relative];
  if (!name) {
    if (relative.endsWith('.node'))
      console.warn(`[slick] no arm64 replacement for ${relative}; x64 addon will fail to load`);
    return filename;
  }
  const candidates = [
    path.join(resources, 'arm64-native', name),
    path.join(slickResources, 'native', 'linux-arm64', name),
  ];
  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      console.log(`[slick] loading arm64 ${relative} from ${candidate}`);
      return candidate;
    }
  }
  console.warn(`[slick] no arm64 replacement for ${relative}; x64 addon will fail to load`);
  return filename;
}

export function slackDesktopUtilsPrebuildUrl(pkg: {
  version: string;
  binary: { production_host: string; package_name: string; module_name: string; napi_versions: number[] };
}): string {
  const { binary, version } = pkg;
  const fields: Record<string, string> = {
    module_name: binary.module_name,
    version,
    napi_build_version: String(Math.max(...binary.napi_versions)),
    platform: 'linux',
    arch: 'arm64',
  };
  if (!binary.napi_versions.length || !binary.production_host.startsWith('https://'))
    throw new Error('invalid Slack native prebuild metadata');
  const name = binary.package_name.replace(/\{(\w+)\}/g, (_, key: string) => {
    if (!(key in fields)) throw new Error(`unknown Slack prebuild field ${key}`);
    return fields[key];
  });
  return `${binary.production_host.replace(/\/$/, '')}/${name}`;
}
