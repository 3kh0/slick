// Mark Slackbot's slash-command registration DMs as read.
//
// The notification half of this lives in main.ts. v1 had the two halves
// disagree about what counted as a notice, because each carried its own copy
// of the rules; both now share `detect.ts`.
//
// v1 also read the messages out of the DOM. v2 watches the RTM stream, so a
// notice is marked read whether or not its channel is on screen.

import { SlickPlugin, type RtmEvent } from '$slick';
import { decodeMrkdwn, isSlackbot, isSlashCommandNotice } from './detect.ts';
import * as meta from './meta.ts';

/** Bounded, so a long session cannot grow this without limit. */
const MAX_REMEMBERED = 300;

export default class ShutUpSlackbot extends SlickPlugin<typeof meta.settings> {
  static readonly id = meta.id;
  static readonly pluginName = meta.pluginName;
  static readonly description = meta.description;
  static readonly defaultEnabled = meta.defaultEnabled;
  static readonly settings = meta.settings;

  private marked = new Set<string>();

  start() {
    this.api.rtm.on('message', (event) => this.consider(event));
  }

  private consider(event: RtmEvent) {
    const channel = event.channel;
    const ts = event.ts;
    if (typeof channel !== 'string' || typeof ts !== 'string') return;
    if (!isSlackbot(event.user, (event as { username?: string }).username)) return;
    if (!isSlashCommandNotice(decodeMrkdwn(event.text))) return;

    void this.markRead(channel, ts);
  }

  private async markRead(channel: string, ts: string) {
    const key = `${channel}:${ts}`;
    if (this.marked.has(key)) return;
    this.marked.add(key);
    if (this.marked.size > MAX_REMEMBERED) {
      this.marked = new Set([...this.marked].slice(-MAX_REMEMBERED / 2));
    }

    try {
      await this.api.userAPI('conversations.mark', { channel, ts }, { signal: this.api.signal });
    } catch (error) {
      // Leave it out of `marked` so a later event can retry it.
      this.marked.delete(key);
      this.log('could not mark the notice read', error);
    }
  }
}
