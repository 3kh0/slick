import { SlickPlugin } from '$slick';
import {
  Favorites,
  filterFavorites,
  fromGiphyProps,
  gifKey,
  searchKlipy,
  searchTenor,
  topKlipy,
  topTenor,
  toSlackPayload,
  type Gif,
} from './gifs.ts';
import * as meta from './meta.ts';

export type PickerProps = {
  onGifSelected?: (event: React.MouseEvent, payload: ReturnType<typeof toSlackPayload>) => void;
  onClosed?: (event: React.MouseEvent) => void;
  emojiSearchQuery?: string;
};

export function isGifPicker(component: unknown): boolean {
  if (typeof component !== 'function' || component.length !== 1) return false;
  const source = Function.prototype.toString.call(component);
  return (
    source.includes('"gif-picker-host"') && source.includes('onGifSelected') && source.includes('emojiSearchQuery')
  );
}

function providerOf(value: unknown): 'tenor' | 'giphy' | 'klipy' {
  return value === 'giphy' || value === 'klipy' ? value : 'tenor';
}

export default class BetterGifs extends SlickPlugin<typeof meta.settings> {
  static readonly id = meta.id;
  static readonly pluginName = meta.pluginName;
  static readonly description = meta.description;
  static readonly defaultEnabled = meta.defaultEnabled;
  static readonly settings = meta.settings;
  static readonly liveSettings = ['provider', 'defaultView'];

  private readonly gifs = new this.api.Store<Gif[]>([]);
  private readonly error = new this.api.Store('');
  private readonly provider = new this.api.Store(providerOf(this.config.provider));
  private readonly favorites = new Favorites(this.api.storage, (gifs) => {
    if (!this.api.signal.aborted) this.gifs.set(gifs);
  });
  private readonly searches = new Map<string, { expires: number; results: Gif[] }>();
  private readonly inflight = new Map<string, Promise<Gif[]>>();

  private search(query: string): Promise<Gif[]> {
    const klipy = this.config.provider === 'klipy';
    const apiKey = String(this.config.klipyApiKey ?? '');
    const text = query.trim().replace(/\s+/g, ' ');
    const key = (klipy ? 'klipy:' : '') + text;
    const cached = this.searches.get(key);
    if (cached && cached.expires > Date.now()) return Promise.resolve(cached.results);
    const pending = this.inflight.get(key);
    if (pending) return pending;
    // Bridge fetches cannot carry AbortSignals. Bound UI waiting and ignore results
    // after unmount/teardown; the underlying request may still finish in the host.
    let timer: ReturnType<typeof setTimeout>;
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error('GIF search timed out. Try again.')), 12_000);
    });
    const lookup = klipy
      ? text
        ? searchKlipy(this.api.fetch, apiKey, query)
        : topKlipy(this.api.fetch, apiKey)
      : text
        ? searchTenor(this.api.fetch, query)
        : topTenor(this.api.fetch);
    const request = Promise.race([lookup, timeout])
      .then((results) => {
        if (!this.api.signal.aborted) {
          this.searches.delete(key);
          this.searches.set(key, { expires: Date.now() + 10 * 60_000, results });
          if (this.searches.size > 20) this.searches.delete(this.searches.keys().next().value!);
        }
        return results;
      })
      .finally(() => {
        clearTimeout(timer);
        this.inflight.delete(key);
      });
    this.inflight.set(key, request);
    return request;
  }

  private readonly Star = ({ gif }: { gif: Gif }) => {
    const saved = this.gifs.use().some((item) => gifKey(item) === gifKey(gif));
    const [pending, setPending] = React.useState(false);
    const [failure, setFailure] = React.useState('');
    const { SvgIcon } = this.api.elements;
    return (
      <>
        <button
          type="button"
          className="c-button-unstyled slick-bg__star"
          aria-label={`${saved ? 'Unfavorite' : 'Favorite'} ${gif.name}`}
          aria-pressed={saved}
          disabled={pending}
          title={failure || (saved ? 'Remove from favorites' : 'Add to favorites')}
          onClick={async (event) => {
            event.stopPropagation();
            setPending(true);
            setFailure('');
            try {
              await this.favorites.toggle(gif);
              if (!this.api.signal.aborted) this.error.set('');
            } catch (error) {
              const message = error instanceof Error ? error.message : 'Could not save favorites.';
              if (!this.api.signal.aborted) {
                setFailure(message);
                this.error.set(message);
              }
            } finally {
              setPending(false);
            }
          }}
        >
          <SvgIcon name={saved ? 'star-filled' : 'star'} size={16} />
        </button>
      </>
    );
  };

  private readonly Card = ({ gif, select }: { gif: Gif; select: (event: React.MouseEvent, gif: Gif) => void }) => {
    const [failed, setFailed] = React.useState(false);
    return (
      <div className="slick-bg__card">
        <button
          type="button"
          className="c-button-unstyled slick-bg__select"
          data-bg-select="true"
          aria-label={`Add ${gif.name} to message`}
          title={gif.name}
          style={{ aspectRatio: `${gif.width} / ${gif.height}` }}
          onClick={(event) => select(event, gif)}
        >
          {!failed && (
            <picture>
              <source media="(prefers-reduced-motion: reduce)" srcSet={gif.previewUrl} />
              <img
                src={gif.animationUrl ?? gif.url}
                alt=""
                loading="lazy"
                referrerPolicy="no-referrer"
                onError={() => setFailed(true)}
              />
            </picture>
          )}
          <span className={failed ? 'slick-bg__fallback' : 'sr-only'}>{gif.name}</span>
        </button>
        <this.Star gif={gif} />
      </div>
    );
  };

  private readonly Picker = ({
    original: Original,
    ...props
  }: PickerProps & { original: React.ComponentType<any> }) => {
    const provider = this.provider.use();
    const favorites = this.gifs.use();
    const favoriteError = this.error.use();
    const canSelect = typeof props.onGifSelected === 'function' && typeof props.onClosed === 'function';
    const [view, setView] = React.useState<'search' | 'favorites'>(
      this.config.defaultView === 'favorites' ? 'favorites' : 'search',
    );
    const [query, setQuery] = React.useState((props.emojiSearchQuery ?? '').slice(0, 100));
    const [favoriteQuery, setFavoriteQuery] = React.useState('');
    const [retry, setRetry] = React.useState(0);
    const [results, setResults] = React.useState<Gif[]>([]);
    const [loading, setLoading] = React.useState(provider !== 'giphy' && view === 'search');
    const [searchError, setSearchError] = React.useState('');
    const input = React.useRef<HTMLInputElement>(null);

    React.useEffect(() => {
      if (provider !== 'giphy' || view === 'favorites') input.current?.focus();
    }, [provider, view]);

    React.useEffect(() => {
      let active = true;
      setResults([]);
      setSearchError('');
      const shouldSearch = provider !== 'giphy' && view === 'search' && canSelect;
      setLoading(shouldSearch);
      if (!shouldSearch) return;
      const timer = setTimeout(
        () => {
          void this.search(query).then(
            (gifs) => {
              if (active && !this.api.signal.aborted) {
                setResults(gifs);
                setLoading(false);
              }
            },
            (error: unknown) => {
              if (active && !this.api.signal.aborted) {
                setSearchError(
                  error instanceof Error
                    ? error.message
                    : `Could not search ${provider === 'klipy' ? 'KLIPY' : 'Tenor'}.`,
                );
                setLoading(false);
              }
            },
          );
        },
        query.trim() ? 350 : 0,
      );
      return () => {
        active = false;
        clearTimeout(timer);
      };
    }, [provider, query, view, retry, canSelect]);

    if (typeof props.onGifSelected !== 'function' || typeof props.onClosed !== 'function')
      return <Original {...props} />;
    const select = (event: React.MouseEvent, gif: Gif) => {
      event.stopPropagation();
      try {
        props.onClosed!(event);
        props.onGifSelected!(event, toSlackPayload(gif));
      } catch {
        this.error.set('Could not add this GIF to the draft. Try Slack’s Giphy picker.');
      }
    };
    const shown = view === 'favorites' ? filterFavorites(favorites, favoriteQuery) : results;
    const name = provider === 'klipy' ? 'KLIPY' : 'Tenor';
    const native = provider === 'giphy' && view === 'search';
    const status =
      view === 'favorites'
        ? !favorites.length
          ? 'No favorites yet. Use the star on a GIF to save it here.'
          : !shown.length
            ? 'No favorites match your search.'
            : ''
        : loading
          ? query.trim()
            ? `Searching ${name}…`
            : 'Loading top GIFs…'
          : !results.length && !searchError
            ? query.trim()
              ? 'No GIFs found.'
              : 'No top GIFs available.'
            : '';

    return (
      <div className="slick-bg" data-qa="slick_better_gifs">
        <div className="slick-bg__toolbar">
          <label className="slick-bg__provider">
            <span className="sr-only">GIF provider</span>
            <select
              aria-label="GIF provider"
              value={provider}
              onChange={(event) => {
                try {
                  this.api.settings.set('provider', event.target.value);
                } catch {
                  this.error.set('Could not change GIF provider.');
                }
              }}
            >
              <option value="tenor">Tenor</option>
              <option value="klipy">KLIPY</option>
              <option value="giphy">Giphy</option>
            </select>
          </label>
          <button
            type="button"
            className="c-button-unstyled slick-bg__tab"
            aria-pressed={view === 'search'}
            onClick={() => setView('search')}
          >
            Search
          </button>
          <button
            type="button"
            className="c-button-unstyled slick-bg__tab"
            aria-pressed={view === 'favorites'}
            onClick={() => setView('favorites')}
          >
            Favorites ({favorites.length})
          </button>
        </div>
        {favoriteError && (
          <div className="slick-bg__error" role="alert">
            {favoriteError}
          </div>
        )}
        {native ? (
          <Original {...props} />
        ) : (
          <>
            <header className="p-gif_picker__header">
              <input
                ref={input}
                type="search"
                className="c-input_text"
                aria-label={view === 'favorites' ? 'Search favorite GIFs' : `Search GIFs on ${name}`}
                placeholder={view === 'favorites' ? 'Search favorites' : `Search GIFs on ${name}`}
                value={view === 'favorites' ? favoriteQuery : query}
                maxLength={100}
                onChange={(event) => {
                  const value = event.target.value;
                  if (view === 'favorites') {
                    setFavoriteQuery(value);
                  } else {
                    setQuery(value);
                    setLoading(true);
                    setResults([]);
                    setSearchError('');
                  }
                }}
              />
            </header>
            <div className="slick-bg__content" aria-busy={loading && view === 'search'}>
              {status && (
                <p className={loading && view === 'search' ? 'sr-only' : 'slick-bg__status'} role="status">
                  {status}
                </p>
              )}
              {searchError && view === 'search' && (
                <div className="slick-bg__status" role="alert">
                  {searchError}{' '}
                  <button type="button" onClick={() => setRetry((value) => value + 1)}>
                    Retry
                  </button>
                </div>
              )}
              <div
                className="slick-bg__grid"
                onKeyDown={(event) => {
                  const buttons = [...event.currentTarget.querySelectorAll<HTMLButtonElement>('[data-bg-select]')];
                  const index = buttons.indexOf(event.target as HTMLButtonElement);
                  if (index < 0) return;
                  let next: HTMLButtonElement | undefined;
                  if (event.key === 'Home') next = buttons[0];
                  else if (event.key === 'End') next = buttons.at(-1);
                  else {
                    const direction = {
                      ArrowRight: [1, 0],
                      ArrowLeft: [-1, 0],
                      ArrowDown: [0, 1],
                      ArrowUp: [0, -1],
                    }[event.key];
                    if (!direction) return;
                    const rect = buttons[index]!.getBoundingClientRect();
                    let nearest = Infinity;
                    for (const button of buttons) {
                      const target = button.getBoundingClientRect();
                      const dx = target.left + target.width / 2 - rect.left - rect.width / 2;
                      const dy = target.top + target.height / 2 - rect.top - rect.height / 2;
                      const forward = dx * direction[0]! + dy * direction[1]!;
                      const sideways = Math.abs(dx * direction[1]! + dy * direction[0]!);
                      const distance = forward + sideways * 2;
                      if (forward > 1 && distance < nearest) {
                        next = button;
                        nearest = distance;
                      }
                    }
                  }
                  event.preventDefault();
                  next?.focus();
                }}
              >
                {Array.from({ length: 3 }, (_value, column) => (
                  <div key={column} className="slick-bg__column">
                    {loading && view === 'search'
                      ? Array.from({ length: 3 }, (_, index) => (
                          <div key={index} className="slick-bg__skeleton" aria-hidden="true" />
                        ))
                      : shown
                          .filter((_, index) => index % 3 === column)
                          .map((gif) => <this.Card key={gifKey(gif)} gif={gif} select={select} />)}
                  </div>
                ))}
              </div>
            </div>
            {view === 'search' && (
              <footer className="slick-bg__footer">
                GIFs via{' '}
                <a
                  href={provider === 'klipy' ? 'https://klipy.com' : 'https://tenor.com'}
                  target="_blank"
                  rel="noreferrer"
                >
                  {name}
                </a>
                {provider === 'tenor' && ' · Results via tenor-proxy.vercel.app'}
              </footer>
            )}
          </>
        )}
      </div>
    );
  };

  start() {
    this.api.setStyle(`
      .slick-bg { color: var(--dt_color-content-pry); width: 361px; max-width: calc(100vw - 24px); }
      .slick-bg__toolbar { display: flex; align-items: center; gap: 4px; padding: 8px 12px; }
      .slick-bg__provider { margin-right: auto; }
      .slick-bg__provider select { font: inherit; font-size: 13px; font-weight: 700; color: inherit; background: transparent; border: 0; border-radius: 6px; padding: 6px 2px; cursor: pointer; }
      .slick-bg__provider select option { color: var(--dt_color-content-pry); background: var(--dt_color-surf-pry); }
      .slick-bg__tab { font-size: 13px; font-weight: 700; border-radius: 6px; padding: 6px 8px; color: var(--dt_color-content-sec); }
      .slick-bg__tab[aria-pressed=true] { color: var(--dt_color-content-pry); background: var(--dt_color-surf-sec); }
      .slick-bg__tab:hover { color: var(--dt_color-content-pry); background: var(--dt_color-surf-sec); }
      .slick-bg .p-gif_picker__header { padding: 0 12px 8px; }
      .slick-bg input { width: 100%; font-size: 15px; margin: 0; }
      .slick-bg__content { height: 336px; overflow-y: auto; padding: 0 12px 8px; }
      .slick-bg__grid { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); align-items: start; gap: 4px; }
      .slick-bg__column { display: flex; flex-direction: column; min-width: 0; gap: 4px; }
      .slick-bg__card, .slick-bg__native-card { position: relative; min-width: 0; }
      .slick-bg__select { width: 100%; height: auto; border-radius: 6px; overflow: hidden; display: flex; align-items: center; justify-content: center; background: var(--dt_color-surf-sec); }
      .slick-bg__select picture { display: block; width: 100%; height: 100%; }
      .slick-bg__select img { display: block; width: 100%; height: 100%; object-fit: contain; }
      .slick-bg__skeleton { height: 104px; border-radius: 6px; background: var(--dt_color-surf-sec); position: relative; overflow: hidden; }
      .slick-bg__skeleton::after { content: ''; position: absolute; inset: 0; background: linear-gradient(90deg, transparent, var(--dt_color-surf-pry), transparent); animation: slick-bg-shimmer 1.2s ease-in-out infinite; }
      @keyframes slick-bg-shimmer { from { transform: translateX(-100%); } to { transform: translateX(100%); } }
      .slick-bg__fallback { font-size: 12px; padding: 8px; }
      .slick-bg__star { position: absolute; top: 5px; right: 5px; display: flex; align-items: center; justify-content: center; width: 28px; height: 28px; border-radius: 8px; color: var(--dt_color-content-pry); background: var(--dt_color-surf-pry); border: 0; box-shadow: none; z-index: 1; opacity: 0; transition: opacity 100ms; }
      .slick-bg__star[aria-pressed=true] { color: var(--dt_color-content-warning, #de9b22); opacity: 1; }
      .slick-bg__card:hover .slick-bg__star, .slick-bg__card:focus-within .slick-bg__star, .slick-bg__native-card:hover .slick-bg__star, .slick-bg__native-card:focus-within .slick-bg__star { opacity: 1; }
      .slick-bg__star:hover { background: var(--dt_color-surf-sec); }
      .slick-bg__star:disabled { opacity: .5; }
      .slick-bg button:focus-visible, .slick-bg select:focus-visible, .slick-bg__native-card button:focus-visible { outline: 2px solid var(--dt_color-content-pry); outline-offset: -2px; }
      .slick-bg__status { padding: 40px 16px; margin: 0; text-align: center; font-size: 13px; line-height: 20px; color: var(--dt_color-content-sec); }
      .slick-bg__error { padding: 8px 12px; font-size: 13px; color: var(--dt_color-content-destructive); }
      .slick-bg__footer { padding: 8px 12px; font-size: 11px; color: var(--dt_color-content-sec); border-top: 1px solid var(--dt_color-otl-ter); }
      .slick-bg__native-card { flex: 1; }
      .slick-bg__native-card > .p-gif_picker__row_item { width: 100%; }
      @media (hover: none) { .slick-bg__star { opacity: 1; } }
      @media (prefers-reduced-motion: reduce) { .slick-bg__star { transition: none; } .slick-bg__skeleton::after { animation: none; } }
    `);
    void this.favorites.load().catch(() => {
      if (!this.api.signal.aborted) this.error.set('Could not load favorites. Try reopening the picker.');
    });
    this.api.patchComponent<PickerProps>({ filter: isGifPicker }, (Original) => (props) => (
      <this.Picker {...props} original={Original as React.ComponentType<any>} />
    ));
    this.api.patchComponent<Record<string, unknown>>('GifListItem', (Original) => (props) => {
      const gif = fromGiphyProps(props);
      return gif ? (
        <div className="slick-bg__native-card">
          <Original {...props} />
          <this.Star gif={gif} />
        </div>
      ) : (
        <Original {...props} />
      );
    });
  }

  onSettingsChange() {
    this.provider.set(providerOf(this.config.provider));
    this.searches.clear();
  }

  stop() {
    this.searches.clear();
    this.inflight.clear();
  }
}
