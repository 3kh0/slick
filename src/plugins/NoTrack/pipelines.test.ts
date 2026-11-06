import assert from 'node:assert/strict';
import { test } from 'node:test';
import { suppressTelemetryPipelines } from './pipelines.ts';

test('suppresses only specified metric methods, preserving noop receivers, arguments and return objects', () => {
  let work = 0;
  class Tracer {
    shouldSample() {
      work++;
      return true;
    }
  }
  class Meter {
    counter(_name: string) {
      work++;
      return { real: true };
    }
    unrelated() {
      return 'unchanged';
    }
  }
  class NoopMeter {
    #result = { real: false };
    names: string[] = [];
    counter(name: string) {
      this.names.push(name);
      return this.#result;
    }
    unrelated() {
      return 'do not copy this';
    }
  }
  const tracer = new Tracer();
  const telemeter = new Meter();
  const noopTelemeter = new NoopMeter();
  const tracerDescriptor = Object.getOwnPropertyDescriptor(Tracer.prototype, 'shouldSample');
  const meterDescriptor = Object.getOwnPropertyDescriptor(Meter.prototype, 'counter');
  const guard = suppressTelemetryPipelines({ tracer, telemeter, noopTelemeter, metricMethods: ['counter', 'counter'] });
  assert.deepEqual(guard.patched, ['shouldSample', 'counter']);
  assert.equal(tracer.shouldSample(), false);
  const result = telemeter.counter('navigation');
  assert.equal(result, noopTelemeter.counter('other'));
  assert.deepEqual(noopTelemeter.names, ['navigation', 'other']);
  assert.equal(telemeter.unrelated(), 'unchanged');
  assert.equal(work, 0);
  guard.stop();
  guard.stop();
  assert.deepEqual(Object.getOwnPropertyDescriptor(Tracer.prototype, 'shouldSample'), tracerDescriptor);
  assert.deepEqual(Object.getOwnPropertyDescriptor(Meter.prototype, 'counter'), meterDescriptor);
  assert.equal(tracer.shouldSample(), true);
  assert.deepEqual(telemeter.counter('restored'), { real: true });
  assert.equal(work, 2);
});

test('missing, inherited, accessor, frozen and shared prototypes are left intact', () => {
  let reads = 0;
  const accessor = Object.create({
    get shouldSample() {
      reads++;
      return () => true;
    },
  });
  class Base {
    shouldSample() {
      return true;
    }
  }
  class Derived extends Base {}
  const inherited = new Derived();
  const own = { shouldSample: () => true };
  const frozen = Object.create(Object.freeze({ shouldSample: () => true }));
  for (const tracer of [undefined, null, 0, {}, Object.create(null), accessor, inherited, own, frozen]) {
    const guard = suppressTelemetryPipelines({ tracer });
    assert.deepEqual(guard.patched, []);
    guard.stop();
  }
  assert.equal(reads, 0);
  assert.equal(inherited.shouldSample(), true);
  const shared = new Base();
  assert.deepEqual(
    suppressTelemetryPipelines({ telemeter: shared, noopTelemeter: new Base(), metricMethods: ['shouldSample'] })
      .patched,
    [],
  );
});

test('restoration respects later patches and does not overwrite their ownership', () => {
  class Tracer {
    shouldSample() {
      return true;
    }
  }
  const tracer = new Tracer();
  const guard = suppressTelemetryPipelines({ tracer });
  const later = () => true;
  Tracer.prototype.shouldSample = later;
  guard.stop();
  assert.equal(Tracer.prototype.shouldSample, later);
});

test('nonconfigurable writable methods restore their original descriptor', () => {
  const proto = {};
  Object.defineProperty(proto, 'shouldSample', { value: () => true, writable: true, configurable: false });
  const tracer = Object.create(proto);
  const before = Object.getOwnPropertyDescriptor(proto, 'shouldSample');
  const guard = suppressTelemetryPipelines({ tracer });
  assert.equal(tracer.shouldSample(), false);
  guard.stop();
  assert.deepEqual(Object.getOwnPropertyDescriptor(proto, 'shouldSample'), before);
});
