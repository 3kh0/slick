import assert from 'node:assert/strict';
import { test } from 'node:test';
import { allowMediaKeys } from './mediaKeys.ts';

function commandLine(initial: Record<string, string>) {
  const switches = new Map(Object.entries(initial));
  return {
    switches,
    getSwitchValue: (name: string) => switches.get(name) ?? '',
    removeSwitch: (name: string) => void switches.delete(name),
    appendSwitch: (name: string, value?: string) => void switches.set(name, value ?? ''),
  };
}

test('drops HardwareMediaKeyHandling from the features Slack disables', () => {
  const line = commandLine({
    'disable-features': ',WebRtcHideLocalIpsWithMdns,HardwareMediaKeyHandling,LogJsConsoleMessages',
  });
  allowMediaKeys(line);
  assert.equal(line.switches.get('disable-features'), 'WebRtcHideLocalIpsWithMdns,LogJsConsoleMessages');
});

test('removes the switch when nothing else is disabled', () => {
  const line = commandLine({ 'disable-features': 'HardwareMediaKeyHandling' });
  allowMediaKeys(line);
  assert.equal(line.switches.has('disable-features'), false);
});

test('leaves other disabled features alone', () => {
  const line = commandLine({ 'disable-features': ',CalculateNativeWinOcclusion' });
  allowMediaKeys(line);
  assert.equal(line.switches.get('disable-features'), ',CalculateNativeWinOcclusion');
});
