// Mark message senders who have not completed identity verification.
//
// v1 had the renderer queue user ids into a global, and the main process poll
// that global every 800ms with `executeJavaScript`, then push results back the
// same way -- a busy-wait across the process boundary, running forever whether
// or not anything was on screen.
//
// v2 asks once per user, from the component that renders their name, through a
// cache that dedups in-flight requests. Nothing runs when nothing is
// rendering.

import { SlickPlugin } from '$slick';
import * as meta from './meta.ts';

type SenderProps = { botId?: string; userId?: string; className?: string };

const STATUS_TTL_MS = 24 * 60 * 60 * 1000;
const USER_ID = /^[UW][A-Z0-9]+$/;

const CLASS: Record<string, string> = {
  unverified: 'slick-hca-unverified',
  over_18: 'slick-hca-over-18',
};

export default class HcaStatus extends SlickPlugin<typeof meta.settings> {
  static readonly id = meta.id;
  static readonly pluginName = meta.pluginName;
  static readonly description = meta.description;
  static readonly defaultEnabled = meta.defaultEnabled;
  static readonly settings = meta.settings;
  static readonly liveSettings = ['unverifiedColor', 'over18Color'];

  private statuses = this.api.Cache<meta.HcaStatus | null>('hca_status', STATUS_TTL_MS);

  start() {
    this.applyStyle();

    this.api.patchComponent<SenderProps>('BaseMessageSender', (Original) => (props) => {
      const userId = props.userId;
      // A bot has no identity to verify, and Slackbot is not a person.
      const lookupFor = !props.botId && userId && USER_ID.test(userId) && userId !== 'USLACKBOT' ? userId : null;

      const [status, setStatus] = React.useState<meta.HcaStatus | null>(() =>
        lookupFor ? (this.statuses.peek(lookupFor) ?? null) : null,
      );

      React.useEffect(() => {
        if (!lookupFor) return;
        let live = true;
        this.lookUp(lookupFor).then((result) => {
          if (live) setStatus(result);
        });
        return () => {
          live = false;
        };
      }, [lookupFor]);

      const marker = status ? CLASS[status] : undefined;
      if (!marker) return <Original {...props} />;
      return <Original {...props} className={props.className ? `${props.className} ${marker}` : marker} />;
    });
  }

  onSettingsChange() {
    this.applyStyle();
  }

  private applyStyle() {
    const unverified = String(this.config.unverifiedColor);
    const over18 = String(this.config.over18Color);
    this.api.setStyle(`
      .slick-hca-unverified,
      .slick-hca-unverified .c-message__sender_button {
        text-decoration: underline wavy ${unverified} !important;
        text-decoration-thickness: 1px !important;
      }
      .slick-hca-over-18,
      .slick-hca-over-18 .c-message__sender_button {
        text-decoration: underline wavy ${over18} !important;
        text-decoration-thickness: 1px !important;
      }
    `);
  }

  private async lookUp(userId: string): Promise<meta.HcaStatus | null> {
    try {
      // Through the main half: the check is cross-origin from the Slack page.
      return await this.statuses.get(userId, () => this.api.main.call<meta.HcaStatus | null>('check', userId));
    } catch (error) {
      this.log('could not check verification status', error);
      return null;
    }
  }
}
