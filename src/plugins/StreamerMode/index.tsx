// Blur private information while someone else can see your screen. Native
// notifications are silenced by the main half.

import { SlickPlugin } from '$slick';
import { REVEAL_CLASS, ROOT_CLASS, streamerCss, THREAD_CLASS } from './css.ts';
import * as meta from './meta.ts';

type MessageProps = { msg?: { channel?: string }; className?: string };

const THREADS_VIEW = '.p-threads_view';
const LIST_ITEM = '.c-virtual_list__item';

/** The thread a row belongs to, from the key its list item carries. */
function threadOf(row: Element): string {
  const key = row.getAttribute('data-item-key') ?? '';
  const [channel, ts] = key.replace(/^(?:heading|root|footer)-/, '').split('-');
  return ts ? `${channel}-${ts}` : '';
}

export default class StreamerMode extends SlickPlugin<typeof meta.settings> {
  static readonly id = meta.id;
  static readonly pluginName = meta.pluginName;
  static readonly description = meta.description;
  static readonly defaultEnabled = meta.defaultEnabled;
  static readonly settings = meta.settings;
  static readonly liveSettings = ['dmPreviewBlur', 'privateChannelNames', 'vipStatus', 'blur'];

  private readonly active = new this.api.Store<boolean>(false);
  /** A screen share turned it on, so the share ending turns it off again. */
  private autoActivated = false;
  private originalGetDisplayMedia: MediaDevices['getDisplayMedia'] | null = null;
  private revealedThread = '';

  start() {
    this.api.setStyle(this.css(), 'redaction');
    this.markPrivateThreads();
    this.followThreadHover();
    this.injectButton();

    if (this.config.activation === 'always') this.apply(true);
    else this.watchScreenShares();
  }

  stop() {
    document.documentElement.classList.remove(ROOT_CLASS);
    if (this.originalGetDisplayMedia) {
      navigator.mediaDevices.getDisplayMedia = this.originalGetDisplayMedia;
      this.originalGetDisplayMedia = null;
    }
    // Leave the main half unmuted even if the plugin stopped mid-share.
    if (this.api.loader === 'electron') void this.api.main.call('setActive', false).catch(() => {});
  }

  onSettingsChange() {
    this.api.setStyle(this.css(), 'redaction');
  }

  private css(): string {
    return `${streamerCss({
      blur: Number(this.config.blur) || 4,
      dmPreviewBlur: String(this.config.dmPreviewBlur),
      privateChannelNames: this.config.privateChannelNames !== false,
      vipStatus: this.config.vipStatus !== false,
    })}
      html.${ROOT_CLASS} :is(
        [data-qa*="notification_toast" i],
        [data-qa*="desktop_notification" i],
        [class*="notification_toast" i],
        [class*="desktop_notification" i],
        .p-notification_bar
      ) {
        filter: blur(${Number(this.config.blur) || 4}px);
      }
    `;
  }

  private apply(active: boolean) {
    this.active.set(active);
    document.documentElement.classList.toggle(ROOT_CLASS, active);
    if (this.api.loader !== 'electron') return;
    // Worst case on failure is a visible notification, so just log.
    void this.api.main.call('setActive', active).catch((error) => this.log('could not reach the main half', error));
  }

  private toggle = () => {
    this.autoActivated = false;
    this.apply(!this.active.get());
  };

  // Patched in the page: it must see shares Slack starts itself, and needs the
  // stream to know when the share ends.
  private watchScreenShares() {
    const media = navigator.mediaDevices;
    if (typeof media?.getDisplayMedia !== 'function') {
      this.log('screen-share detection is unavailable in this runtime');
      return;
    }

    const original = media.getDisplayMedia.bind(media);
    this.originalGetDisplayMedia = media.getDisplayMedia;
    const shares = new Set<MediaStream>();

    const ended = (stream: MediaStream) => {
      shares.delete(stream);
      if (shares.size || !this.autoActivated) return;
      this.autoActivated = false;
      this.apply(false);
    };

    media.getDisplayMedia = async (...args) => {
      const stream = await original(...args);
      if (this.api.signal.aborted) return stream;

      shares.add(stream);
      if (!this.active.get()) {
        this.autoActivated = true;
        this.apply(true);
      }
      for (const track of stream.getTracks()) {
        track.addEventListener('ended', () => ended(stream), { once: true });
      }
      stream.addEventListener('inactive', () => ended(stream), { once: true });
      return stream;
    };
  }

  /** Tag messages in private channels, so the thread pane can redact them. */
  private markPrivateThreads() {
    this.api.patchComponent<MessageProps>('MessageBackground', (Original) => (props) => {
      const id = props.msg?.channel;
      const channel = id ? this.api.channels.getCachedChannel(id) : undefined;
      if (!channel?.is_private && !channel?.is_mpim && !channel?.is_im) return <Original {...props} />;
      return <Original {...props} className={`${props.className ?? ''} ${THREAD_CLASS}`} />;
    });
  }

  // A thread's rows are flat siblings in the virtual list, so :hover can't
  // reveal a whole thread.
  private followThreadHover() {
    const follow = (event: Event) => {
      const view = document.querySelector(THREADS_VIEW);
      if (!view) return;

      const target = event.target;
      const row = target instanceof Element ? target.closest(LIST_ITEM) : null;
      const thread = row && view.contains(row) ? threadOf(row) : '';
      if (thread === this.revealedThread) return;

      this.revealedThread = thread;
      for (const item of view.querySelectorAll(LIST_ITEM)) {
        item.classList.toggle(REVEAL_CLASS, !!thread && threadOf(item) === thread);
      }
    };

    const types = ['pointerover', 'focusin'] as const;
    for (const type of types) window.addEventListener(type, follow, true);
    this.api.signal.addEventListener('abort', () => {
      for (const type of types) window.removeEventListener(type, follow, true);
    });
  }

  private injectButton() {
    const { Tooltip, SvgIcon } = this.api.elements;
    const label = (active: boolean) => (active ? 'Turn off streamer mode' : 'Turn on streamer mode');

    this.api.patchComponent<Record<string, unknown>>('HelpButton', (Original) => (props) => {
      const active = this.active.use();
      return (
        <>
          <div className="p-top_nav__windows_controls_container slick-streamer-mode__container">
            <Tooltip tip={label(active)} position="bottom" delay={500}>
              <button
                type="button"
                className="c-button-unstyled p-top_nav__button p-top_nav__help slick-streamer-mode__button"
                aria-label={label(active)}
                aria-pressed={active}
                onClick={this.toggle}
              >
                <SvgIcon name={active ? 'eye-closed' : 'eye-open'} size={20} />
              </button>
            </Tooltip>
          </div>
          <Original {...props} />
        </>
      );
    });
  }
}
