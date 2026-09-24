// Join channels from a link to them. Double-clicking a channel link joins it:
// a single click on a link to a channel you're not in is held back briefly,
// then replayed to Slack if no second click follows. Code channels also get a
// Join button on their hover card: ChannelHoverCard has one for regular
// channels, but code channels render CodeChannelEntityCard in its place, which
// only offers Join for a private channel reached through an unfurl. The same
// card is the code channel unfurl block, so that gets the button too.

import { SlickPlugin, type SlackChannel } from '$slick';
import * as meta from './meta.ts';

type CardProps = {
  channelId: string;
  borderless?: boolean;
  joinableFromChannelId?: string;
};

/** A regular channel link, or a code channel's slug. The composer also carries data-channel-id, on a div. */
const CHANNEL_LINK = 'a[data-channel-id], .p-rich_text_slug[data-id]';
const DOUBLE_CLICK_MS = 300;
const FLASH_MS = 1500;

/** The channel a window is showing, for Slack's code channel join, which needs one the link was seen in. */
const channelInView = (doc: Document): string | undefined =>
  doc.defaultView?.location.pathname.match(/\/client\/[^/]+\/([CG][A-Z0-9]+)/)?.[1];

const canJoin = (channel: SlackChannel | undefined): channel is SlackChannel =>
  !!channel && channel.is_channel === true && !channel.is_private && !channel.is_member && !channel.is_archived;

export default class QuickJoin extends SlickPlugin<typeof meta.settings> {
  static readonly id = meta.id;
  static readonly pluginName = meta.pluginName;
  static readonly description = meta.description;
  static readonly defaultEnabled = meta.defaultEnabled;
  static readonly settings = meta.settings;

  private pending: { link: Element; timer: number } | null = null;
  private replaying = false;

  start() {
    this.api.setStyle(`
      .slick-qj--joining { opacity: 0.6; cursor: progress; }
      .slick-qj--joined { box-shadow: 0 0 0 2px var(--dt_color-brand-core-slack-green, #2eb67d); border-radius: 4px; }
      .slick-qj--failed { box-shadow: 0 0 0 2px var(--dt_color-otl-imp, #e01e5a); border-radius: 4px; }
      .slick-qj-card { padding: 0 16px 12px; }
      .slick-qj-card--unfurl { padding: 8px 0 0; }
    `);

    if (this.config.doubleClick !== false) {
      this.listen(document);
      this.api.onDocument((doc) => this.listen(doc));
    }

    if (this.config.hoverCardButton !== false) {
      // The card is itself a button in most layouts, so the Join button goes after it.
      this.api.patchComponent<CardProps>('CodeChannelEntityCard', (Original) => (props) => (
        <>
          <Original {...props} />
          <this.CardJoinButton {...props} />
        </>
      ));
    }
  }

  stop() {
    if (this.pending) clearTimeout(this.pending.timer);
    this.pending = null;
  }

  private listen(doc: Document) {
    const options = { capture: true, signal: this.api.signal };
    doc.addEventListener('mousedown', this.onMouseDown, options);
    doc.addEventListener('click', this.onClick, options);
  }

  private joinableLink(event: MouseEvent): { link: HTMLElement; channelId: string } | null {
    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return null;
    // Not instanceof: pop-out windows have their own Element.
    const link = (event.target as Element | null)?.closest?.<HTMLElement>(CHANNEL_LINK);
    const channelId = link?.dataset.channelId ?? link?.dataset.id;
    if (!link || !channelId || !canJoin(this.api.channels.getCachedChannel(channelId))) return null;
    return { link, channelId };
  }

  /** Keeps the double-click from selecting the link's text. */
  private readonly onMouseDown = (event: MouseEvent) => {
    if (event.detail > 1 && this.joinableLink(event)) event.preventDefault();
  };

  private readonly onClick = (event: MouseEvent) => {
    if (this.replaying) return;
    const hit = this.joinableLink(event);
    if (!hit) return;

    // Capture on the document runs before React's root listener, so Slack never sees this click.
    event.preventDefault();
    event.stopPropagation();

    if (this.pending?.link === hit.link) {
      clearTimeout(this.pending.timer);
      this.pending = null;
      void this.joinFromLink(hit.link, hit.channelId);
      return;
    }

    if (this.pending) clearTimeout(this.pending.timer);
    const target = event.target as Element;
    const init: MouseEventInit = {
      bubbles: true,
      cancelable: true,
      view: event.view,
      detail: 1,
      clientX: event.clientX,
      clientY: event.clientY,
      screenX: event.screenX,
      screenY: event.screenY,
    };
    const timer = window.setTimeout(() => {
      this.pending = null;
      this.replay(target, init);
    }, DOUBLE_CLICK_MS);
    this.pending = { link: hit.link, timer };
  };

  private replay(target: Element, init: MouseEventInit) {
    const view = target.ownerDocument.defaultView;
    if (!target.isConnected || !view) return;
    this.replaying = true;
    try {
      target.dispatchEvent(new view.MouseEvent('click', init));
    } finally {
      this.replaying = false;
    }
  }

  private async joinFromLink(link: HTMLElement, channelId: string) {
    link.classList.add('slick-qj--joining');
    let outcome: string;
    try {
      await this.join(channelId, channelInView(link.ownerDocument));
      outcome = 'slick-qj--joined';
    } catch (error) {
      console.warn('[slick] [Quick Join] could not join', channelId, error);
      outcome = 'slick-qj--failed';
    }
    link.classList.remove('slick-qj--joining');
    link.classList.add(outcome);
    setTimeout(() => link.classList.remove(outcome), FLASH_MS);
  }

  private readonly CardJoinButton = ({ channelId, borderless, joinableFromChannelId }: CardProps) => {
    const { Button } = this.api.elements;
    const channel = this.api.redux.useReduxState((state): SlackChannel | undefined => state.channels?.[channelId]);
    const [state, setState] = React.useState<'idle' | 'joining' | 'joined' | 'failed'>('idle');

    // Kept after joining, so the card doesn't jump the moment is_member flips.
    if ((state === 'idle' || state === 'failed') && !canJoin(channel)) return null;

    const onClick = (event: React.MouseEvent) => {
      event.preventDefault();
      event.stopPropagation();
      setState('joining');
      this.join(channelId, joinableFromChannelId ?? channelInView(document)).then(
        () => setState('joined'),
        (error) => {
          console.warn('[slick] [Quick Join] could not join', channelId, error);
          setState('failed');
        },
      );
    };

    const label = { idle: 'Join Channel', joining: 'Joining…', joined: 'Joined', failed: 'Couldn’t join, try again' }[
      state
    ];
    return (
      <div className={borderless ? 'slick-qj-card' : 'slick-qj-card slick-qj-card--unfurl'}>
        <Button
          className="full_width"
          type="outline"
          size="small"
          disabled={state === 'joining' || state === 'joined'}
          onClick={onClick}
        >
          {label}
        </Button>
      </div>
    );
  };

  private async join(channelId: string, originChannelId: string | undefined) {
    try {
      await this.api.redux.dispatchThunk('joinChannel', { channelId });
    } catch (error) {
      if (!originChannelId) throw error;
      await this.api.redux.dispatchThunk('joinCodeChannel', { channelId, originChannelId });
    }
  }
}
