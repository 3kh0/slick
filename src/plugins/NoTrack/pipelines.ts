type PipelineTargets = {
  tracer?: unknown;
  telemeter?: unknown;
  noopTelemeter?: unknown;
  /** Explicitly verified metric methods; never replace arbitrary methods. */
  metricMethods?: readonly string[];
};

const isObject = (value: unknown): value is object =>
  (typeof value === 'object' && value !== null) || typeof value === 'function';

function ownMethod(instance: unknown, name: string) {
  if (!isObject(instance) || Object.hasOwn(instance, name)) return null;
  const prototype: object | null = Object.getPrototypeOf(instance);
  // Do not walk into shared ancestors or patch Object.prototype on shape drift.
  if (!prototype || prototype === Object.prototype || prototype === Function.prototype) return null;
  const descriptor = Object.getOwnPropertyDescriptor(prototype, name);
  if (!descriptor || typeof descriptor.value !== 'function') return null;
  return { prototype, descriptor };
}

/** No discovery/polling: callers supply verified live exports or leave a pipeline unchanged. */
export function suppressTelemetryPipelines({ tracer, telemeter, noopTelemeter, metricMethods = [] }: PipelineTargets) {
  const restores: (() => void)[] = [];
  const patched: string[] = [];
  const replace = (instance: unknown, name: string, replacement: (...args: unknown[]) => unknown) => {
    try {
      const method = ownMethod(instance, name);
      if (!method || (!method.descriptor.configurable && !method.descriptor.writable)) return;
      Object.defineProperty(method.prototype, name, { ...method.descriptor, value: replacement });
      patched.push(name);
      restores.push(() => {
        // A later extension owns its replacement; do not overwrite it on stop.
        if (Object.getOwnPropertyDescriptor(method.prototype, name)?.value === replacement) {
          Object.defineProperty(method.prototype, name, method.descriptor);
        }
      });
    } catch {
      // Frozen objects, proxies or changed Slack shapes keep their original behavior.
    }
  };

  replace(tracer, 'shouldSample', () => false);
  for (const name of new Set(metricMethods)) {
    if (name === 'constructor') continue;
    try {
      const real = ownMethod(telemeter, name);
      const noop = ownMethod(noopTelemeter, name);
      if (!real || !noop || real.prototype === noop.prototype) continue;
      // No-op implementations may use private fields; their receiver must be
      // the no-op instance rather than the real telemetry object's `this`.
      replace(telemeter, name, (...args) => Reflect.apply(noop.descriptor.value, noopTelemeter, args));
    } catch {
      // This pipeline remains protected by NoTrack's network blocking.
    }
  }

  return {
    patched,
    stop() {
      for (const restore of restores.splice(0).toReversed()) {
        try {
          restore();
        } catch {
          // A newly frozen prototype must not prevent other restorations.
        }
      }
    },
  };
}
