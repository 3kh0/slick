import type { CommandLine } from 'electron';

const FEATURE = 'HardwareMediaKeyHandling';

// Slack disables this, which cuts pages' Media Session off from the system's media keys and controls.
export function allowMediaKeys(
  commandLine: Pick<CommandLine, 'getSwitchValue' | 'removeSwitch' | 'appendSwitch'>,
): void {
  const features = commandLine.getSwitchValue('disable-features').split(',').filter(Boolean);
  if (!features.includes(FEATURE)) return;
  const kept = features.filter((feature) => feature !== FEATURE);
  commandLine.removeSwitch('disable-features');
  if (kept.length) commandLine.appendSwitch('disable-features', kept.join(','));
}
