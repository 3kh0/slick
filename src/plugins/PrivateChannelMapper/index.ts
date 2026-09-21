// Name the private channels Slack will not name, and mention ones you are not
// in. Names come from the Flaron index.
//
// v1 rewrote the label text node of every channel mention it could find,
// re-running over a selector list on each DOM batch and diffing `nodeValue`
// to avoid fighting React. v2 supplies the missing channel object instead, so
// Slack renders the name itself and every surface that resolves a channel --
// mentions, the sidebar, search, autocomplete -- agrees.
//
// `makeChannelObject` carries the denormalized name fields (`name_normalized`,
// `_name_lc`, `previous_names`) for the same reason `modifyMemberObject` does:
// without them a synthesized channel is invisible to search and autocomplete.
//
// Both settings default off, and with them off this plugin makes no requests
// and changes nothing.

import { SlickPlugin, type SlackChannel } from '$slick';
import { CHANNEL_ID } from './flaron.ts';
import * as meta from './meta.ts';

/** Slack's own record for a channel it cannot see carries no usable name. */
function slackKnowsName(channel: SlackChannel | undefined): boolean {
  return (
    !!channel &&
    typeof channel.name === 'string' &&
    channel.name.length > 0 &&
    channel.isNonExistent !== true &&
    channel.isUnknown !== true
  );
}

export default class PrivateChannelMapper extends SlickPlugin<typeof meta.settings> {
  static readonly id = meta.id;
  static readonly pluginName = meta.pluginName;
  static readonly description = meta.description;
  static readonly defaultEnabled = meta.defaultEnabled;
  static readonly settings = meta.settings;
  // Both settings change what is fetched and subscribed to, so a restart on
  // change is simpler than reconciling a half-populated index.

  /** Channel id -> the name Flaron gave us. */
  private names = new Map<string, string>();
  /** Ids already asked about, so a miss is not retried on every render. */
  private asked = new Set<string>();
  private repaintTimer: ReturnType<typeof setTimeout> | null = null;

  async start() {
    if (this.config.flaron !== true) {
      this.log('flaron lookups are off; nothing to do');
      return;
    }

    this.names = new Map(Object.entries(await this.api.storage.get<Record<string, string>>('names', {})));
    if (this.api.signal.aborted) return;

    if (this.config.mentions === true) {
      // Honest about the gap rather than silently doing nothing: naming works,
      // autocompleting a channel Slack hides needs its autocomplete data
      // source, which is not identified yet. See docs/plugins/PrivateChannelMapper.md.
      this.log('mention autocomplete is not ported yet; names still resolve');
    }

    this.api.redux.patchSlice<SlackChannel>('channels', (id, channel) => {
      // Slack wins whenever it can resolve a channel itself.
      if (slackKnowsName(channel)) return channel;
      if (!CHANNEL_ID.test(id)) return channel;

      const name = this.names.get(id);
      if (!name) {
        this.lookUp(id);
        return channel;
      }

      // Marked, so a later read can tell Slick's channel from Slack's.
      return { ...this.api.channels.makeChannelObject({ id, name, isPrivate: true }), slick_synthesized: true };
    });
  }

  stop() {
    if (this.repaintTimer) clearTimeout(this.repaintTimer);
    this.repaintTimer = null;
  }

  private lookUp(id: string) {
    if (this.asked.has(id)) return;
    this.asked.add(id);

    void this.api.main
      .call<string | null>('channel', id)
      .then((name) => {
        if (!name || this.api.signal.aborted) return;
        this.names.set(id, name);
        void this.api.storage.set('names', Object.fromEntries(this.names));
        this.repaint();
      })
      .catch((error) => this.log(`could not resolve ${id}`, error));
  }

  /** A screenful of lookups resolves together; repaint once they settle. */
  private repaint() {
    if (this.repaintTimer) clearTimeout(this.repaintTimer);
    this.repaintTimer = setTimeout(() => {
      if (!this.api.signal.aborted) this.api.redux.refresh();
    }, 150);
  }
}
