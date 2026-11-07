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
// Slack's draw-others and draw-others-off icons (20x20), the path only
const DRAW_OTHERS_PATH =
  'M7.75 1.5a.75.75 0 0 1 0 1.5h-6a.75.75 0 0 1 0-1.5zm9.6 6.658a.25.25 0 0 0 0-.353l-.626-.627-1.06 1.061.626.626a.25.25 0 0 0 .354 0zM13.246 3.7a.25.25 0 0 0-.1-.06l-1.518-.497.497 1.519a.25.25 0 0 0 .06.1l2.419 2.417 1.06-1.06zm4.46 6.227a1.75 1.75 0 0 1-2.476 0l-4.105-4.105a1.75 1.75 0 0 1-.426-.694L10.05 3.14a1.25 1.25 0 0 1 1.575-1.576l1.987.649c.262.085.5.231.694.426l4.105 4.105a1.75 1.75 0 0 1 0 2.475zm-4.597 2.475a.25.25 0 0 0 0-.354l-.626-.626-1.061 1.06.626.627a.25.25 0 0 0 .354 0zm-4.106-4.46a.25.25 0 0 0-.1-.06l-1.518-.497.496 1.518a.25.25 0 0 0 .061.1l2.418 2.418 1.061-1.06zm4.458 6.227a1.75 1.75 0 0 1-2.474 0L6.88 10.063a1.75 1.75 0 0 1-.426-.694l-.648-1.986a1.25 1.25 0 0 1 1.576-1.576l1.986.648c.262.086.5.232.694.426l4.106 4.106a1.75 1.75 0 0 1 0 2.474zm-4.596 2.12a.25.25 0 0 1 0 .354l-.707.708a.25.25 0 0 1-.353 0l-.627-.627 1.061-1.06zm-4.204-4.165a.25.25 0 0 1 .1.06l2.417 2.419-1.06 1.06-2.419-2.418a.25.25 0 0 1-.06-.1l-.497-1.517zm2.083 6.287a1.75 1.75 0 0 0 2.475 0l.707-.707a1.75 1.75 0 0 0 0-2.475l-4.105-4.105a1.75 1.75 0 0 0-.694-.426L3.14 10.05a1.25 1.25 0 0 0-1.576 1.575l.649 1.987c.085.262.231.5.426.694zM4.5 6.5a.75.75 0 0 0-.75-.75h-2a.75.75 0 0 0 0 1.5h2a.75.75 0 0 0 .75-.75';
const DRAW_OTHERS_OFF_PATH =
  'M7.75 1.5a.75.75 0 0 1 0 1.5h-6a.75.75 0 0 1 0-1.5zm9.6 6.658a.25.25 0 0 0 0-.353l-.626-.627-1.06 1.061.626.626a.25.25 0 0 0 .354 0zm-5.723-5.016.928.303L13.74 2.26a2 2 0 0 0-.128-.047l-1.987-.649A1.25 1.25 0 0 0 10.05 3.14l.648 1.987q.021.065.047.128l1.186-1.186zm2.207 5.388 3.182-3.182 1.395 1.396a1.75 1.75 0 0 1 0 2.475l-.707.707a1.75 1.75 0 0 1-2.475 0zM9.369 6.455q.066.022.128.048L8.312 7.688l-.927-.303.303.927-1.185 1.185a2 2 0 0 1-.048-.128l-.648-1.986a1.25 1.25 0 0 1 1.576-1.576zm-4.242 4.243q.065.021.128.047l-1.186 1.186-.927-.303.303.927L2.26 13.74a2 2 0 0 1-.047-.128l-.649-1.987A1.25 1.25 0 0 1 3.14 10.05zm3.403 3.136-3.182 3.182 1.396 1.395a1.75 1.75 0 0 0 2.475 0l.707-.707a1.75 1.75 0 0 0 0-2.475zm4.243-4.243-3.182 3.182 1.396 1.396a1.75 1.75 0 0 0 2.474 0l.708-.708a1.75 1.75 0 0 0 0-2.474zm.335 2.81a.25.25 0 0 0 0-.354l-.626-.626-1.061 1.06.626.627a.25.25 0 0 0 .354 0zM8.865 16.29a.25.25 0 0 1 0 .354l-.707.707a.25.25 0 0 1-.353 0l-.627-.627 1.061-1.06zM4.5 6.5a.75.75 0 0 0-.75-.75h-2a.75.75 0 0 0 0 1.5h2a.75.75 0 0 0 .75-.75M2.07 17.13a.75.75 0 0 0 1.06 0l14-14a.75.75 0 1 0-1.06-1.06l-14 14a.75.75 0 0 0 0 1.06';

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
    // the mic's icon wrapper, so the icon sits in the same box as the mic icon
    const micChild = mic.firstElementChild as HTMLElement | null;
    this.iconTemplate =
      micChild && micChild.tagName.toLowerCase() !== 'svg' ? (micChild.cloneNode(false) as HTMLElement) : undefined;
    button.dataset.letmesee = 'hide-drawings';
    button.setAttribute('type', 'button');
    button.setAttribute('role', 'switch');
    button.addEventListener('click', () => drawings.set(!drawings.hidden));
    this.hintRoot = root;
    // the same hover hint as the other buttons, shown in place of the activity text
    button.addEventListener('mouseover', () => this.showHint(true));
    button.addEventListener('mouseout', () => this.showHint(false));

    // size the icon to the mic's icon as it renders, falling back to 20px
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

    // the mic's icon wrapper when there is one, else a box the size of the mic icon
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
    // draw-others when drawings are shown, draw-others-off when hidden
    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    path.setAttribute('fill', 'currentColor');
    path.setAttribute('fill-rule', 'evenodd');
    path.setAttribute('clip-rule', 'evenodd');
    path.setAttribute('d', hidden ? DRAW_OTHERS_OFF_PATH : DRAW_OTHERS_PATH);
    svg.append(path);
    box.append(svg);
    button.replaceChildren(box);
  }
}
