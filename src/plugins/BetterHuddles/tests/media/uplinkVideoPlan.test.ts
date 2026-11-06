import { describe, it } from 'node:test';
import { expect, itEach } from '../expect.ts';
import { browserFamily, uplinkVideoPlan } from '../../media/videoQuality.ts';

describe('browserFamily', () => {
  itEach([
    [true, 'firefox', 'chromium'],
    [false, 'firefox', 'firefox'],
    [false, 'safari', 'safari'],
    [false, 'ios', 'safari'],
    [false, 'unknown', 'other'],
  ] as const)('chromium=%s name=%s → %s', (hasChromium, name, family) => {
    expect(browserFamily(hasChromium, name)).toBe(family);
  });
});

describe('uplinkVideoPlan', () => {
  it('uses simulcast at 720p on Chromium so each viewer gets a layer their connection can take', () => {
    expect(uplinkVideoPlan('chromium')).toMatchObject({
      simulcast: true,
      codecs: null,
      capture: { height: { ideal: 720 } },
    });
  });

  it("avoids Chime's VP9-first default without simulcast, with a lighter single stream", () => {
    expect(uplinkVideoPlan('firefox')).toMatchObject({
      simulcast: false,
      codecs: ['vp8', 'h264'],
      capture: { height: { ideal: 360 } },
    });
    expect(uplinkVideoPlan('safari').codecs).toEqual(['h264', 'vp8']);
    expect(uplinkVideoPlan('other').codecs?.[0]).toBe('vp8');
  });
});
