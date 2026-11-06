import assert from 'node:assert/strict';
import { afterEach, beforeEach, test } from 'node:test';
import { build } from 'esbuild';

const bundle = await build({
  entryPoints: [new URL('./index.ts', import.meta.url).pathname],
  bundle: true,
  write: false,
  platform: 'node',
  format: 'esm',
});
const { default: NoTrack } = await import(
  `data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0]!.text).toString('base64')}`
);

let previousWindow: PropertyDescriptor | undefined;
beforeEach(() => {
  class FakeXHR extends EventTarget {
    open() {}
    send() {}
  }
  previousWindow = Object.getOwnPropertyDescriptor(globalThis, 'window');
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: { XMLHttpRequest: FakeXHR, fetch: globalThis.fetch, navigator },
  });
});
afterEach(() => {
  if (previousWindow) Object.defineProperty(globalThis, 'window', previousWindow);
  else Reflect.deleteProperty(globalThis, 'window');
});

test('loaded telemetry factories stop producing work and restore on plugin restart, with cleanup intact', (t) => {
  let generated = 0;
  let clears = 0;
  let searches = 0;
  class Tracer {
    shouldSample() {
      return true;
    }
    createSpan() {
      if (this.shouldSample()) generated++;
      return { sampled: this.shouldSample() };
    }
  }
  class Telemeter {
    store(value: number) {
      generated++;
      return value;
    }
    measure() {
      generated++;
      return 12;
    }
    clearMarks() {
      clears++;
    }
    clearMeasures() {
      clears++;
    }
    emptyMetrics() {
      clears++;
    }
    measureAndClear() {
      const result = this.measure();
      this.clearMarks();
      return result;
    }
    setUser() {
      return this;
    }
  }
  class NoopTelemeter {
    store(value: number) {
      return value;
    }
    measure() {
      return false;
    }
    clearMarks() {}
    clearMeasures() {}
    emptyMetrics() {}
    measureAndClear() {
      return false;
    }
  }
  const tracer = new Tracer();
  const telemeter = new Telemeter();
  const noop = new NoopTelemeter();
  // Discovery uses Slack's export names; keep them explicit across test runtimes.
  function getGenericTracer() {
    return tracer;
  }
  function getGenericTelemeter() {
    return telemeter;
  }
  function getNoopTelemeter() {
    return noop;
  }
  const exports = [getGenericTracer, getGenericTelemeter, getNoopTelemeter, () => undefined];
  const plugin = new NoTrack(
    {
      getExport(matcher: (value: unknown) => boolean, all: boolean) {
        searches++;
        assert.equal(all, true);
        return exports.filter(matcher);
      },
    },
    { blockBeacons: false },
  );
  plugin.log = () => {};
  t.after(() => plugin.stop());
  for (let iteration = 0; iteration < 2; iteration++) {
    plugin.start();
    assert.deepEqual(tracer.createSpan(), { sampled: false });
    assert.equal(telemeter.store(42), 42);
    assert.equal(telemeter.measureAndClear(), false);
    telemeter.clearMeasures();
    telemeter.emptyMetrics();
    assert.equal(clears, 3 * (iteration + 1));
    assert.equal(telemeter.setUser(), telemeter);
    assert.equal(generated, iteration * 3);
    plugin.stop();
    assert.deepEqual(tracer.createSpan(), { sampled: true });
    telemeter.store(42);
    assert.equal(telemeter.measure(), 12);
  }
  assert.equal(searches, 2, 'one loaded-export scan per start; no discovery listener or poll');
  assert.equal(generated, 6);
});

test('missing or throwing telemetry factories leave beacon transport protection operational', (t) => {
  let sends = 0;
  const previous = Object.getOwnPropertyDescriptor(navigator, 'sendBeacon');
  Object.defineProperty(navigator, 'sendBeacon', { configurable: true, writable: true, value: () => ++sends > 0 });
  t.after(() => {
    plugin.stop();
    if (previous) Object.defineProperty(navigator, 'sendBeacon', previous);
    else Reflect.deleteProperty(navigator, 'sendBeacon');
  });
  function getGenericTracer() {
    throw new Error('changed Slack internals');
  }
  const plugin = new NoTrack({ getExport: () => [getGenericTracer] }, { blockBeacons: true });
  plugin.log = () => {};
  plugin.start();
  assert.equal(navigator.sendBeacon('https://slackb.com/beacon'), true);
  assert.equal(sends, 0);
  assert.equal(navigator.sendBeacon('https://example.com/allowed'), true);
  assert.equal(sends, 1);
  plugin.stop();
  navigator.sendBeacon('https://slackb.com/beacon');
  assert.equal(sends, 2);
});
