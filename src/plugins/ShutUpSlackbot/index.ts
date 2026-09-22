// Mark Slackbot's slash-command registration DMs as read (main.ts silences the
// notification). Watches the RTM stream, so it works whether or not the
// channel is on screen.

import { SlickPlugin, type RtmEvent } from '$slick';
import { decodeMrkdwn, isSlackbot, isSlashCommandNotice } from './detect.ts';
import * as meta from './meta.ts';

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
      // Allow a later event to retry.
      this.marked.delete(key);
      this.log('could not mark the notice read', error);
    }
  }
}
