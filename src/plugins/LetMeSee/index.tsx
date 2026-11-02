import { SlickPlugin } from '$slick';
import * as meta from './meta.ts';

// local-only: hiding drawings never reaches the other people in the huddle
const drawings = {
  hidden: false,
  listeners: new Set<() => void>(),
  set(hidden: boolean) {
    this.hidden = hidden;
    for (const listen of this.listeners) listen();
  },
  subscribe(listen: () => void) {
    this.listeners.add(listen);
    return () => this.listeners.delete(listen);
  },
};

const useDrawingsHidden = (): boolean =>
  React.useSyncExternalStore(
    (listen) => drawings.subscribe(listen),
    () => drawings.hidden,
  );

const PANEL_CLASS = 'p-huddle_mini_panel';
const STOP_CLASS = 'p-huddle_mini_panel__button--stop-screen-share-updated';
const ACTIVE_CLASS = 'p-huddle_mini_panel__button--active';
// the strike across the brush, bottom-left to top-right, in the 20x20 box
const STRIKE = 'M3 17L17 3';

// Slack's non-filled paintbrush icon from its icon set (20x20), the path only
const BRUSH_PATH =
  'M17.57 1.246c.39-.039.902.004 1.283.385s.424.893.386 1.282c-.04.405-.18.846-.362 1.284-.368.882-.984 1.927-1.675 2.961-1.386 2.072-3.172 4.249-4.187 5.264-1.022 1.022-2.013 1.629-3.003 1.721q-.157.015-.308.012c.088.567.022 1.196-.262 1.886-.54 1.31-1.647 1.997-2.759 2.274-1.094.272-2.27.173-3.129-.157a5.4 5.4 0 0 1-1.927-1.276 4.7 4.7 0 0 1-.54-.663 2.2 2.2 0 0 1-.299-.601 1 1 0 0 1-.033-.175.8.8 0 0 1 .033-.337.78.78 0 0 1 .701-.547c.116-.009.23.01.254.014h.004l.007.001c.04.006.062.01.088.012h.002c.057.005.227.02.54-.203.27-.191.423-.493.654-1.053l.034-.085c.204-.499.481-1.176 1.059-1.716.673-.631 1.514-.777 2.26-.662l.016.002a3 3 0 0 1-.003-.373C6.46 9.494 7.03 8.5 8.063 7.469c1.015-1.015 3.191-2.801 5.263-4.186 1.035-.692 2.079-1.308 2.962-1.676.437-.182.879-.322 1.283-.361M14.16 4.53a43 43 0 0 0-4.211 3.234 7 7 0 0 1 1.6 1.158 6.4 6.4 0 0 1 1.184 1.6 43 43 0 0 0 3.222-4.198c.673-1.006 1.225-1.955 1.537-2.704.158-.378.235-.662.254-.853l.002-.031-.03.002c-.192.02-.476.097-.854.254-.748.312-1.698.865-2.704 1.538M7.9 10.58c.024-.41.24-.967.897-1.706q.119.05.26.12a5.6 5.6 0 0 1 1.444 1.003 4.95 4.95 0 0 1 1.118 1.683c-.756.68-1.33.93-1.747.97-.428.04-.846-.13-1.307-.63-.492-.531-.69-.987-.665-1.44m9.963-7.84-.005-.002q.006 0 .005.002m-.118-.115-.001-.005zm-12.59 9.999c.269-.252.614-.335 1.008-.275.409.063.817.277 1.091.541.371.357.686.705.856 1.108.154.364.21.825-.056 1.472-.312.757-.953 1.195-1.734 1.39-.799.198-1.66.116-2.23-.102a3.9 3.9 0 0 1-1.332-.865q.235-.104.494-.287c.664-.47.954-1.175 1.163-1.685l.009-.02c.233-.567.4-.967.73-1.277m-3.658 3.43h.008z';

export default class LetMeSee extends SlickPlugin<typeof meta.settings> {
  static readonly requiredAPIs = [] as const;
  static readonly id = meta.id;
  static readonly pluginName = meta.pluginName;
  static readonly description = meta.description;
  static readonly category = meta.category;
  static readonly defaultEnabled = meta.defaultEnabled;
  static readonly settings = meta.settings;

  /** the button and its wrapper, copies of the mic button and its wrapper so the layout matches */
  private button: HTMLElement | undefined;
  private wrapper: HTMLElement | undefined;
  private iconSize = 20;
  private iconTemplate: HTMLElement | undefined;
  private slashTemplate: HTMLElement | undefined;
  /** fallback until Slack's own slash icon has been seen */
  private strikeColor = '#E01E5A';
  private hintRoot: HTMLElement | undefined;
  private unsubscribeDrawings: (() => void) | undefined;
  private guard: MutationObserver | undefined;

  start() {
    const Anchor = this.makeAnchor();

    // the floating bar's root is the anchor's previous sibling
    this.api.patchComponent('HuddleMiniPanel', (Original) => (props) => (
      <>
        <Original {...props} />
        <Anchor />
      </>
    ));

    // hidden with display:none rather than unmounted, so the strokes already drawn survive a toggle
    this.api.patchComponent('BaseDrawRenderer', (Original) => (props) => {
      const hidden = useDrawingsHidden();
      return (
        <div style={{ display: hidden ? 'none' : 'contents' }}>
          <Original {...props} />
        </div>
      );
    });

    this.unsubscribeDrawings = drawings.subscribe(() => this.paint());
  }

  stop() {
    this.unsubscribeDrawings?.();
    this.unmountButton();
    drawings.set(false);
  }

  /** a hidden element rendered after the floating bar, used to find the bar's root */
  private makeAnchor(): React.FC {
    return () => {
      const ref = React.useRef<HTMLSpanElement>(null);
      React.useLayoutEffect(() => {
        const root = ref.current?.previousElementSibling as HTMLElement | null;
        if (root?.classList.contains(PANEL_CLASS)) this.mountButton(root);
      });
      React.useEffect(() => () => this.unmountButton(), []);
      return <span ref={ref} style={{ display: 'none' }} />;
    };
  }

  /** puts the button in its own copy of the mic's wrapper, just before Stop Sharing's wrapper */
  private mountButton(root: HTMLElement) {
    if (this.button?.isConnected && root.contains(this.button)) return;
    this.unmountButton();

    const stop = root.querySelector<HTMLElement>(`.${STOP_CLASS}`);
    const mic = root.querySelector<HTMLElement>('[aria-label="Microphone"]');
    if (!stop || !mic?.parentElement) return;

    // Slack wraps each mini panel button in a plain div (MiniPanelButtonHint), so copy that too
    const wrapper = mic.parentElement.cloneNode(false) as HTMLElement;
    const button = mic.cloneNode(false) as HTMLElement;
    button.removeAttribute('id');
    button.removeAttribute('aria-describedby');
    button.removeAttribute('disabled');
    // keep Slack's own button classes so the size and styling match; only the mute modifier is dropped
    button.className = mic.className
      .replace(/\bp-huddle_mini_panel__button--mute\b/g, '')
      .replace(/\s+/g, ' ')
      .trim();
    button.classList.add('p-huddle_mini_panel__button');
    // the mic's icon wrapper, so the brush sits in the same box as the mic icon
    const micChild = mic.firstElementChild as HTMLElement | null;
    this.iconTemplate =
      micChild && micChild.tagName.toLowerCase() !== 'svg' ? (micChild.cloneNode(false) as HTMLElement) : undefined;
    button.dataset.letmesee = 'hide-drawings';
    button.setAttribute('type', 'button');
    button.setAttribute('role', 'switch');
    button.addEventListener('click', () => drawings.set(!drawings.hidden));
    // Slack's own strike icon, from the Draw button when it is in the off state, copied so the strike matches
    const slash = root.querySelector<HTMLElement>('.p-huddle_mini_panel__icon--slash');
    this.slashTemplate = slash ? (slash.cloneNode(true) as HTMLElement) : undefined;
    this.hintRoot = root;
    // the same hover hint as the other buttons, shown in place of the activity text
    button.addEventListener('mouseover', () => this.showHint(true));
    button.addEventListener('mouseout', () => this.showHint(false));

    // size the brush to the mic's icon as it renders, falling back to 20px
    const micIcon = mic.querySelector('svg, span, i') as HTMLElement | null;
    const measured = micIcon?.getBoundingClientRect().width ?? 0;
    this.iconSize = measured >= 8 ? Math.round(measured) : 20;
    wrapper.append(button);

    this.wrapper = wrapper;
    this.button = button;
    this.placeWrapper(root);
    this.guard?.disconnect();
    // Draw toggling re-renders the bar and can move our wrapper, so put it back when that happens
    this.guard = new MutationObserver(() => this.placeWrapper(root));
    this.guard.observe(root, { childList: true });
    this.paint();
  }

  /** between Draw and Stop Sharing: directly before Stop Sharing's top-level child of the bar */
  private placeWrapper(root: HTMLElement) {
    const wrapper = this.wrapper;
    const stop = root.querySelector<HTMLElement>(`.${STOP_CLASS}`);
    if (!wrapper || !stop) return;
    let top: HTMLElement = stop;
    while (top.parentElement && top.parentElement !== root) top = top.parentElement;
    if (wrapper.parentElement === root && wrapper.nextElementSibling === top) return;
    top.before(wrapper);
  }

  private unmountButton() {
    this.showHint(false);
    this.guard?.disconnect();
    this.guard = undefined;
    this.wrapper?.remove();
    this.wrapper = undefined;
    this.button = undefined;
    this.hintRoot = undefined;
  }

  /** shows Slack's hint div in place of the activity text, like the other buttons do */
  private showHint(on: boolean) {
    const root = this.hintRoot;
    if (!root) return;
    const activity = root.querySelector<HTMLElement>('.p-huddle_mini_panel__activity');
    let hint = root.querySelector<HTMLElement>('[data-letmesee="hint"]');
    if (on) {
      if (!hint) {
        hint = document.createElement('div');
        hint.className = 'p-huddle_mini_panel__hint_message';
        hint.dataset.letmesee = 'hint';
        root.prepend(hint);
      }
      hint.textContent = drawings.hidden ? 'Show drawings' : 'Hide drawings';
      if (activity) activity.style.display = 'none';
    } else {
      hint?.remove();
      if (activity) activity.style.display = '';
    }
  }

  private paint() {
    const button = this.button;
    if (!button) return;
    const hidden = drawings.hidden;
    button.setAttribute('aria-label', 'Drawings');
    button.setAttribute('aria-checked', String(!hidden));
    button.classList.toggle(ACTIVE_CLASS, !hidden);

    // the mic's icon wrapper when there is one, else a box the size of the mic icon; the slash is an HTML line over the brush
    const box = this.iconTemplate
      ? (this.iconTemplate.cloneNode(false) as HTMLElement)
      : document.createElement('span');
    if (!this.iconTemplate)
      box.style.cssText = `display:inline-flex;align-items:center;justify-content:center;width:${this.iconSize}px;height:${this.iconSize}px;`;
    box.style.position = 'relative';
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('width', String(this.iconSize));
    svg.setAttribute('height', String(this.iconSize));
    svg.setAttribute('viewBox', '0 0 20 20');
    svg.setAttribute('aria-hidden', 'true');
    svg.style.cssText = 'display:block;color:inherit;';
    // rotated 90 degrees around the centre of the 20x20 box, scaled to 85% around the centre of the box
    const brush = `<g transform="translate(10 10) scale(0.85) translate(-10 -10)"><path fill="currentColor" fill-rule="evenodd" clip-rule="evenodd" transform="rotate(90 10 10)" d="${BRUSH_PATH}"/></g>`;
    // while hidden, the brush is cut away along the strike with a gap (a buffer), like Slack's pencil strike
    // the strike takes Slack's own slash colour, read from its slash icon whenever the Draw button shows one
    const slash = this.hintRoot?.querySelector<HTMLElement>('.p-huddle_mini_panel__icon--slash');
    if (slash) this.strikeColor = getComputedStyle(slash).color || this.strikeColor;
    svg.innerHTML = hidden
      ? `<defs><mask id="letmesee-gap" maskUnits="userSpaceOnUse" x="0" y="0" width="20" height="20"><rect width="20" height="20" fill="white"/><path d="${STRIKE}" stroke="black" stroke-width="5.5" stroke-linecap="round"/></mask></defs><g mask="url(#letmesee-gap)">${brush}</g><path d="${STRIKE}" stroke="${this.strikeColor}" stroke-width="1.8" stroke-linecap="round"/>`
      : brush;
    box.append(svg);
    button.replaceChildren(box);
  }
}
