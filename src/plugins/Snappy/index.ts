// Make Slack feel more responsive.
//
// The renderer half is CSS and resize gating. Spellcheck and the Chromium
// switches are process-level concerns and live in main.ts: v1 disabled
// spellcheck by subscribing to the DOM hub and setting an attribute on every
// contenteditable it found, which is both a per-mutation cost and the wrong
// layer -- Electron can just turn the spellchecker off for the session.

import { SlickPlugin } from '$slick';
import * as meta from './meta.ts';
import { overrideTransitions } from './transitions.ts';

/** How still the window must be before Slack is allowed to re-lay-out. */
const QUIET_MS = 150;

const RESIZING = 'slick-resizing';
const LEFT_BASIS = '--slick-top-nav-left-basis';
// Recorded in docs/slack-internals.md. If Slack renames this the resize gate
// still works; only the stand-in below stops being applied, and the top nav
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

  /** `[window width, the basis Slack settled on]`, most recent last. */
  private samples: [number, number][] = [];

  start() {
    // Slack animates almost everything through transitions; collapsing the
    // duration is what actually makes the client feel immediate.
    const transitions = overrideTransitions((css, key) => this.api.setStyle(css, key));
    this.api.signal.addEventListener('abort', () => transitions.stop(), { once: true });

    // Not a live setting: registering and unregistering the gate is start/stop
    // work, so toggling it takes the restart path rather than silently doing
    // nothing until the next launch.
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

  /**
   * Slack sizes the top nav's left container from JavaScript, so pausing that
   * work would freeze it at its pre-drag width while everything around it
   * moves. The width it picks is linear in the window width, so two samples are
   * enough to express the same thing as a `calc()` the compositor can evaluate
   * for free.
   */
  private onHoldChange(holding: boolean) {
    const { classList, style } = document.documentElement;
    if (holding) {
      // Without a sampled basis the stand-in would be worse than freezing.
      if (style.getPropertyValue(LEFT_BASIS)) classList.add(RESIZING);
      return;
    }
    classList.remove(RESIZING);
    // Slack writes its own basis as it re-renders; read it after that. The
    // teardown path releases the hold too, and this must not put the property
    // back on the document after stop() has just taken it off.
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

    // One sample only fixes the ratio through the origin; the second gives the
    // real slope and intercept.
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
