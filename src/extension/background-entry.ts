import plugins from 'slick:background-plugins';
import getBuiltinThemes from 'slick:builtin-themes';
import { createBackground } from './background.ts';
import { extensionBrowser } from './rpc.ts';

const api = extensionBrowser();
// Registered synchronously so the browser can wake the background for messages.
if (api) api.runtime.onMessage.addListener(createBackground(api, plugins, undefined, undefined, getBuiltinThemes));
