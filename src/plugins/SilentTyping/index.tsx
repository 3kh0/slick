import { SlickPlugin } from '$slick';
import * as meta from './meta.ts';

export default class SilentTyping extends SlickPlugin<typeof meta.settings> {
  static readonly requiredAPIs = ['redux', 'elements'] as const;
  static readonly id = meta.id;
  static readonly pluginName = meta.pluginName;
  static readonly description = meta.description;
  static readonly category = meta.category;
  static readonly defaultEnabled = meta.defaultEnabled;
  static readonly settings = meta.settings;

  static readonly liveSettings = ['active', 'inThreads'];

  private listeners = new Set<() => void>();

  start() {
    for (const name of ['currentUserStartedTyping', 'currentUserEndedTyping']) {
      this.api.redux.patchThunk(name, (original) => (...args: unknown[]) => {
        if (this.config.active === false) return original(...args);
        if (!this.config.inThreads && this.isThread(args)) return original(...args);
        // no-op thunk still has to be dispatchable
        return () => undefined;
      });
    }
    if (this.config.composerButton !== false) this.installButton();
    this.log('typing indicators suppressed');
  }

  onSettingsChange() {
    for (const listener of this.listeners) listener();
  }

  private isThread(args: unknown[]): boolean {
    const first = args[0] as { threadTs?: string; thread_ts?: string } | undefined;
    return !!(first?.threadTs || first?.thread_ts);
  }

  private installButton() {
    const { Tooltip } = this.api.elements;
    const subscribe = (listener: () => void) => {
      this.listeners.add(listener);
      return () => this.listeners.delete(listener);
    };
    const Toggle = () => {
      const active = React.useSyncExternalStore(subscribe, () => this.config.active !== false);
      const label = active ? 'Disable silent typing' : 'Enable silent typing';
      return (
        <Tooltip tip={label} position="top">
          <button
            type="button"
            className="c-button-unstyled c-icon_button c-icon_button--size_smedium c-wysiwyg_container__button c-icon_button--default slick-silent-typing-button"
            aria-label={label}
            aria-pressed={active}
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => void this.api.settings.set('active', !active)}
          >
            <svg
              width="18"
              height="18"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.8"
              strokeLinecap="round"
              aria-hidden="true"
            >
              <rect x="2.5" y="6" width="19" height="12" rx="2" />
              <path d="M6 10h.01M10 10h.01M14 10h.01M18 10h.01M8 14h8" />
              {active && <path d="M3 3l18 18" />}
            </svg>
          </button>
        </Tooltip>
      );
    };
    this.api.patchComponent<{ children?: React.ReactNode }>('TextyButtonOverflow', (Original) => (props) => (
      <Original {...props}>
        {props.children}
        <Toggle />
      </Original>
    ));
    this.api.setStyle(
      `.slick-silent-typing-button[aria-pressed="true"] { color: var(--dt_color-content-hgl-1, #1d9bd1); }`,
      'button',
    );
  }
}
