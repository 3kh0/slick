// Make Slack feel more responsive: CSS and resize gating here; spellcheck and
// Chromium switches are session/process-level and live in main.ts.

import { SlickPlugin } from '$slick';
import * as meta from './meta.ts';
import { overrideTransitions } from './transitions.ts';

const QUIET_MS = 150;

const RESIZING = 'slick-resizing';
const LEFT_BASIS = '--slick-top-nav-left-basis';
// If Slack renames this, only the stand-in basis breaks; the top nav just
// holds its width until the drag ends.
const LEFT_CONTAINER = '.p-ia4_top_nav__left_container';

const TOP_NAV_CSS = `
  .${RESIZING} ${LEFT_CONTAINER} {
    flex-basis: var(${LEFT_BASIS}) !important;
  }
`;

export default class Snappy extends SlickPlugin<typeof meta.settings> {
  static readonly id = meta.id;
  static readonly pluginName = meta.pluginName;
  static readonly description = meta.description;
  static readonly defaultEnabled = meta.defaultEnabled;
  static readonly settings = meta.settings;
  static readonly liveSettings = ['disableSpellcheck'];
  // Chromium switches are read once at process start, so these cannot apply live.
  static readonly relaunchSettings = ['ignoreGpuBlocklist', 'disableCrashReporter'];

  /** [window width, Slack's basis], most recent last. */
  private samples: [number, number][] = [];

  start() {
    const transitions = overrideTransitions((css, key) => this.api.setStyle(css, key));
    this.api.signal.addEventListener('abort', () => transitions.stop(), { once: true });

    // Not live: the gate is registered in start/stop, so toggling restarts.
    if (this.config.optimizeResize) {
      this.api.setStyle(TOP_NAV_CSS, 'top-nav');
      this.sampleLeftBasis();
      this.api.deferResizeWork({
        quietMs: QUIET_MS,
        onHoldChange: (holding) => this.onHoldChange(holding),
      });
      this.log('animations disabled, resize work deferred');
      return;
    }

    this.log('animations disabled');
  }

  stop() {
    document.documentElement.classList.remove(RESIZING);
    document.documentElement.style.removeProperty(LEFT_BASIS);
  }

  // Slack sizes the top nav's left container from JS, so gating resize work
  // would freeze it. Its width is linear in window width, so two samples give
  // an equivalent calc() that costs nothing.
  private onHoldChange(holding: boolean) {
    const { classList, style } = document.documentElement;
    if (holding) {
      // Without a sampled basis the stand-in would be worse than freezing.
      if (style.getPropertyValue(LEFT_BASIS)) classList.add(RESIZING);
      return;
    }
    classList.remove(RESIZING);
    // Read after Slack re-renders its basis. Teardown also releases the hold,
    // so don't re-set the property after stop() cleared it.
    requestAnimationFrame(() => {
      if (this.api.signal.aborted) return;
      this.sampleLeftBasis();
    });
  }

  private sampleLeftBasis() {
    const container = document.querySelector<HTMLElement>(LEFT_CONTAINER);
    const basis = Number.parseFloat(container?.style.flexBasis ?? '');
    const width = window.innerWidth;
    if (!Number.isFinite(basis) || !width) return;

    const previous = this.samples.at(-1);
    if (previous && Math.abs(previous[0] - width) < 1) return;
    this.samples = [...this.samples, [width, basis] as [number, number]].slice(-2);

    const [first, last] = this.samples;
    let value = `calc(100vw * ${first[1] / first[0]})`;
    if (last) {
      const slope = (last[1] - first[1]) / (last[0] - first[0]);
      if (!(slope > 0)) return;
      value = `calc(${last[1]}px + ${slope} * (100vw - ${last[0]}px))`;
    }
    document.documentElement.style.setProperty(LEFT_BASIS, value);
  }
}
