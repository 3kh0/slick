import plugins from 'slick:background-plugins';
import { installUserscriptBridge } from './bridge.ts';
import { violentmonkeyApi } from './gm.ts';
installUserscriptBridge(window, violentmonkeyApi(), plugins);
