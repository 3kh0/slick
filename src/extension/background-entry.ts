import plugins from 'slick:background-plugins';
import builtinThemesJson from 'slick:builtin-themes';
import type { ThemeJson } from '../shared/themes.ts';
import { createBackground } from './background.ts';
import { extensionBrowser } from './rpc.ts';

let cachedThemes: Record<string, ThemeJson> | null = null;
const getBuiltinThemes = () => (cachedThemes ??= JSON.parse(builtinThemesJson) as Record<string, ThemeJson>);

const api = extensionBrowser();
// Registered synchronously so the browser can wake the background for messages.
if (api) api.runtime.onMessage.addListener(createBackground(api, plugins, undefined, undefined, getBuiltinThemes));
