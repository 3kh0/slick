import plugins from 'slick:background-plugins';
import { createBackground } from './background.ts';
import { extensionBrowser } from './rpc.ts';

const api = extensionBrowser();
// Registered synchronously so Firefox can wake the suspended event page for it.
if (api) api.runtime.onMessage.addListener(createBackground(api, plugins));
