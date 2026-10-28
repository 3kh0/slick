import { SlickPlugin } from '$slick';
import { replacements, videoIdOf, type Branding, type Replace } from './branding.ts';
import * as meta from './meta.ts';

type YouTubeProps = {
  messageTs?: string;
  title?: string;
  titleLink?: string;
  thumbUrl?: string;
  fromUrl?: string;
  originalUrl?: string;
};
type Toggle = { on: boolean; toggle: () => void };
type Title = { wrap: boolean; toggle: Toggle | null };
type Prefs = { replace: Replace; byDefault: boolean; button: boolean; wrap: boolean };

const FOUND_TTL_MS = 6 * 60 * 60 * 1000;
const MISSING_TTL_MS = 30 * 60 * 1000;
const NO_SWAP = { title: undefined, thumbUrl: undefined };

export default class DeArrow extends SlickPlugin<typeof meta.settings> {
  static readonly requiredAPIs = ['elements'] as const;
  static readonly id = meta.id;
  static readonly pluginName = meta.pluginName;
  static readonly description = meta.description;
  static readonly defaultEnabled = meta.defaultEnabled;
  static readonly settings = meta.settings;
  static readonly liveSettings = ['replace', 'dearrowByDefault', 'showButton', 'wrapTitles'];

  private readonly Title = React.createContext<Title | null>(null);
  private readonly active = new this.api.Store(false);
  private readonly prefs = new this.api.Store<Prefs>({ replace: 'all', byDefault: true, button: true, wrap: false });
  private readonly flipped = new this.api.Store<ReadonlySet<string>>(new Set());
  private readonly brandings = this.api.Cache<Branding | null>(
    'branding',
    (branding) => (branding ? FOUND_TTL_MS : MISSING_TTL_MS),
    500,
  );

  private useBranding(videoId: string | null) {
    const [branding, setBranding] = React.useState(() => (videoId ? (this.brandings.peek(videoId) ?? null) : null));
    React.useEffect(() => {
      setBranding(videoId ? (this.brandings.peek(videoId) ?? null) : null);
      if (!videoId) return;
      let live = true;
      this.lookUp(videoId).then((result) => {
        if (live) setBranding(result);
      });
      return () => {
        live = false;
      };
    }, [videoId]);
    return branding;
  }

  private async lookUp(videoId: string): Promise<Branding | null> {
    try {
      return await this.brandings.get(videoId, () => this.api.main.call<Branding | null>('branding', videoId));
    } catch (error) {
      this.log('could not reach DeArrow', error);
      return null;
    }
  }

  start() {
    const { Tooltip } = this.api.elements;
    this.active.set(true);
    this.api.signal.addEventListener('abort', () => this.active.set(false), { once: true });
    this.onSettingsChange();

    this.api.setStyle(`
      .slick-dearrow {
        display: flex;
        align-items: center;
        gap: 4px;
        max-width: 100%;
      }
      .slick-dearrow > .c-message_attachment__title {
        min-width: 0;
      }
      .slick-dearrow--wrap {
        align-items: flex-start;
      }
      .slick-dearrow--wrap > .c-message_attachment__title,
      .slick-dearrow--wrap > .c-message_attachment__title * {
        white-space: normal;
        overflow-wrap: anywhere;
      }
      .slick-dearrow__toggle {
        flex: none;
        display: inline-flex;
        padding: 2px;
        border: 0;
        border-radius: 4px;
        background: none;
        cursor: pointer;
      }
      .slick-dearrow__toggle:hover {
        background: var(--dt_color-base-pry-hover);
      }
      .slick-dearrow__toggle:focus-visible {
        outline: 2px solid var(--dt_color-content-pry);
        outline-offset: -2px;
      }
      .slick-dearrow__toggle--off svg {
        filter: grayscale(1);
        opacity: 0.6;
      }
    `);

    this.api.patchComponent<YouTubeProps>('MessageAttachmentYouTube', (Original) => (props) => {
      const active = this.active.use();
      const prefs = this.prefs.use();
      const flipped = this.flipped.use();
      const videoId = active ? videoIdOf(props.fromUrl ?? props.originalUrl ?? props.titleLink) : null;
      const branding = this.useBranding(videoId);
      const key = `${props.messageTs}:${videoId}`;
      const swap = videoId ? replacements(videoId, branding, prefs.replace) : NO_SWAP;
      const on = prefs.byDefault !== flipped.has(key);
      const canSwap = !!(swap.title || swap.thumbUrl);
      const showButton = canSwap && prefs.button;
      const title = React.useMemo(() => {
        if (!videoId || (!showButton && !prefs.wrap)) return null;
        const toggle = () => {
          const next = new Set(this.flipped.get());
          if (!next.delete(key)) next.add(key);
          this.flipped.set(next);
        };
        return { wrap: prefs.wrap, toggle: showButton ? { on, toggle } : null };
      }, [videoId, showButton, prefs.wrap, on, key]);
      return (
        <this.Title.Provider value={title}>
          <Original
            {...props}
            title={(on && swap.title) || props.title}
            thumbUrl={(on && swap.thumbUrl) || props.thumbUrl}
          />
        </this.Title.Provider>
      );
    });

    this.api.patchComponent('AttachmentTitle', (Original) => (props) => {
      const title = React.useContext(this.Title);
      if (!title) return <Original {...props} />;
      const { toggle } = title;
      return (
        <span className={`slick-dearrow${title.wrap ? ' slick-dearrow--wrap' : ''}`}>
          <Original {...props} />
          {toggle && (
            <Tooltip tip={toggle.on ? 'Show the original' : 'Show DeArrow’s version'}>
              <button
                type="button"
                className={`slick-dearrow__toggle${toggle.on ? '' : ' slick-dearrow__toggle--off'}`}
                aria-label="DeArrow"
                aria-pressed={toggle.on}
                onClick={toggle.toggle}
              >
                <Logo />
              </button>
            </Tooltip>
          )}
        </span>
      );
    });
  }

  onSettingsChange() {
    this.prefs.set({
      replace: (this.config.replace as Replace) ?? 'all',
      byDefault: this.config.dearrowByDefault !== false,
      button: this.config.showButton !== false,
      wrap: this.config.wrapTitles === true,
    });
  }
}

const Logo = () => (
  <svg width="16" height="16" viewBox="0 0 36 36" aria-hidden="true">
    <path
      fill="#1213BD"
      d="M36 18.302c0 4.981-2.46 9.198-5.655 12.462s-7.323 5.152-12.199 5.152s-9.764-1.112-12.959-4.376S0 23.283 0 18.302s2.574-9.38 5.769-12.644S13.271 0 18.146 0s9.394 2.178 12.589 5.442C33.931 8.706 36 13.322 36 18.302z"
    />
    <path
      fill="#88c9f9"
      d="m 30.394282,18.410186 c 0,3.468849 -1.143025,6.865475 -3.416513,9.137917 -2.273489,2.272442 -5.670115,2.92874 -9.137918,2.92874 -3.467803,0 -6.373515,-1.147212 -8.6470033,-3.419654 -2.2734888,-2.272442 -3.5871299,-5.178154 -3.5871299,-8.647003 0,-3.46885 0.9420533,-6.746149 3.2144954,-9.0196379 2.2724418,-2.2734888 5.5507878,-3.9513905 9.0196378,-3.9513905 3.46885,0 6.492841,1.9322561 8.76633,4.204698 2.273489,2.2724424 3.788101,5.2974804 3.788101,8.7663304 z"
    />
    <path
      fill="#0a62a5"
      d="m 23.95823,17.818306 c 0,3.153748 -2.644888,5.808102 -5.798635,5.808102 -3.153748,0 -5.599825,-2.654354 -5.599825,-5.808102 0,-3.153747 2.446077,-5.721714 5.599825,-5.721714 3.153747,0 5.798635,2.567967 5.798635,5.721714 z"
    />
  </svg>
);
