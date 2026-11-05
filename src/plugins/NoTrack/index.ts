// Stop telemetry generation using Slack's own unsampled/no-op paths, then
// block its transport. main.ts covers requests; this half covers page fetch,
// XMLHttpRequest and beacons, including loaders without network blocking.

import { SlickPlugin } from '$slick';
import * as meta from './meta.ts';
import { suppressTelemetryPipelines } from './pipelines.ts';
import { blockTelemetry } from './telemetry.ts';

const FACTORIES = new Set(['getGenericTracer', 'getGenericTelemeter', 'getNoopTelemeter']);
// Keep cleanup methods live so pre-existing metrics/marks can still be freed.
// measureAndClear delegates to the no-op measure and still clears its mark.
const METRIC_METHODS = [
  'recordMetric',
  'getRecordedMetrics',
  'mark',
  'getLatestMark',
  'store',
  'count',
  'measure',
  'logPerfTimingSections',
  'addExperiments',
  'createBeaconURLs',
] as const;

export default class NoTrack extends SlickPlugin<typeof meta.settings> {
  static readonly requiredAPIs = [] as const;
  static readonly id = meta.id;
  static readonly pluginName = meta.pluginName;
  static readonly description = meta.description;
  static readonly category = meta.category;
  static readonly defaultEnabled = meta.defaultEnabled;
  static readonly settings = meta.settings;

  private unblock: (() => void) | null = null;
  private pipelines: ReturnType<typeof suppressTelemetryPipelines> | null = null;

  start() {
    this.stopTelemetryWork();
    this.unblock = blockTelemetry(window, { beacons: this.config.blockBeacons });
    this.log(`telemetry requests blocked in page${this.config.blockBeacons ? ', beacons included' : ''}`);
  }

  private stopTelemetryWork() {
    try {
      // Search already-loaded exports once. Missing internals fall back to
      // transport blocking, without forcing modules or leaving discovery polls.
      const factories = this.api.getExport<() => unknown>(
        (value: unknown) => typeof value === 'function' && FACTORIES.has(value.name),
        true,
      );
      const instances = new Map<string, unknown>();
      for (const factory of factories) {
        if (instances.has(factory.name)) continue;
        try {
          instances.set(factory.name, factory());
        } catch {
          // One changed pipeline must not prevent the others from being stopped.
        }
      }
      this.pipelines = suppressTelemetryPipelines({
        tracer: instances.get('getGenericTracer'),
        telemeter: instances.get('getGenericTelemeter'),
        noopTelemeter: instances.get('getNoopTelemeter'),
        metricMethods: METRIC_METHODS,
      });
      this.log(`stopped ${this.pipelines.patched.length} telemetry methods; transport blocking remains active`);
    } catch (error) {
      this.log('telemetry internals unavailable; transport blocking remains active', error);
    }
  }

  stop() {
    this.pipelines?.stop();
    this.pipelines = null;
    this.unblock?.();
    this.unblock = null;
  }
}
