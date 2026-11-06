import type { SlickBridge } from '../../app/bridge.ts';
import { patchModuleExports } from '../../app/slack/webpack.ts';
import { record } from '../../shared/objects.ts';
import { resolveSettings } from '../../shared/settings.ts';
import * as meta from './meta.ts';
import { createNativeStateGatePatcher } from './stateDescriptors.ts';

type BootContext = Pick<SlickBridge, 'loader' | 'safeMode' | 'initialSettings'>;

/** Native consumers capture these gates during module initialization. */
export function shouldOptimizeStateTracking(bridge: BootContext, slackAlreadyLoaded: boolean): boolean {
  if (bridge.safeMode || slackAlreadyLoaded) return false;
  if (bridge.loader !== 'electron' && bridge.loader !== 'userscript') return false;
  if (typeof bridge.initialSettings !== 'string') return false;
  try {
    const stored: unknown = JSON.parse(bridge.initialSettings);
    if (!record(stored) || stored.enabled === false) return false;
    if (stored.enabled !== undefined && typeof stored.enabled !== 'boolean') return false;
    if (stored.plugins !== undefined && !record(stored.plugins)) return false;
    const plugin = record(stored.plugins) ? stored.plugins[meta.id] : undefined;
    if (plugin !== undefined && !record(plugin)) return false;
    if (plugin?.enabled !== undefined && typeof plugin.enabled !== 'boolean') return false;
    const settings = resolveSettings(meta.settings, meta.defaultEnabled, plugin);
    return settings.enabled && settings.optimizeStateTracking === true;
  } catch {
    return false;
  }
}

export function installStateTrackingOptimization(bridge: BootContext, slackAlreadyLoaded: boolean): void {
  // An unavailable snapshot or saved opt-out adds no module scanning.
  if (!shouldOptimizeStateTracking(bridge, slackAlreadyLoaded)) return;
  patchModuleExports(createNativeStateGatePatcher({ sharedStateDescriptors: true, stableSelectorShapes: true }));
}
