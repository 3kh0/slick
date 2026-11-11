import { SlickPlugin, type Block, type SendCheckContext } from '$slick';
import { openHaikuDialog } from './dialog.ts';
import { blocksToSlackText, dictionaryLookup, findHaiku } from './haiku.ts';
import * as meta from './meta.ts';
import dictionary from './syllable_counts.txt';
import { dictionaryLoader } from './dictionary.ts';

// Orpheus skips this channel (notice_poetry.rb).
const EXCLUDED_CHANNEL = 'C09MATKQM8C';
// Orpheus joins public channels itself when she finds a haiku, but only quotes
// in private ones she was invited to.
const ORPHEUS_USER = 'UM1L1C38X';
// Her checklist runs only on messages shorter than this, in code points.
const MAX_LENGTH = 300;
const MEMBERSHIP_TTL_MS = 5 * 60 * 1000;
const MEMBERS_PAGE_LIMIT = 1000;
const MEMBERS_MAX_PAGES = 10;
// The pinned Orpheus dictionary is bundled offline; see DICTIONARY-NOTICE.txt.

export default class HaikuWarning extends SlickPlugin<typeof meta.settings> {
  static readonly requiredAPIs = ['addSendCheck', 'channels'] as const;
  static readonly id = meta.id;
  static readonly pluginName = meta.pluginName;
  static readonly description = meta.description;
  static readonly category = meta.category;
  static readonly defaultEnabled = meta.defaultEnabled;
  static readonly settings = meta.settings;

  private prompt: { close: () => void } | null = null;
  private readonly dictionary = dictionaryLoader(dictionary);
  private readonly memberships = new Map<string, { member: boolean; checkedAt: number }>();
  private readonly membershipLookups = new Map<string, Promise<boolean>>();

  start() {
    this.api.signal.addEventListener('abort', () => this.stop(), { once: true });
    this.api.addSendCheck((blocks, context) => this.check(blocks, context));
  }

  stop() {
    this.prompt?.close();
    this.prompt = null;
    this.memberships.clear();
    this.membershipLookups.clear();
  }

  private async check(blocks: Block[], context: SendCheckContext): Promise<boolean> {
    if (context.channelId === EXCLUDED_CHANNEL) return true;
    const haiku = await this.findHaiku(blocks);
    if (this.api.signal.aborted || this.api.isActive?.() === false || !haiku) return true;
    if (!(await this.orpheusWouldReply(context.channelId))) return true;
    if (this.api.signal.aborted || this.api.isActive?.() === false) return true;
    this.prompt?.close();
    return new Promise((resolve) => {
      try {
        const handle = openHaikuDialog(context.targetWindow?.document ?? document, haiku, (approved) => {
          if (this.prompt === handle) this.prompt = null;
          resolve(approved && !this.api.signal.aborted && this.api.isActive?.() !== false);
        });
        this.prompt = handle;
      } catch (error) {
        this.log('could not show warning', error);
        resolve(true);
      }
    });
  }

  private async orpheusWouldReply(channelId: string): Promise<boolean> {
    const channel = this.api.channels.getCachedChannel(channelId);
    if (!channel) return true;
    if (channel.is_im) return channel.user === ORPHEUS_USER;
    if (channel.is_mpim) return Array.isArray(channel.members) && channel.members.includes(ORPHEUS_USER);
    if (!channel.is_private && !channel.is_group) return true;
    return this.isOrpheusMember(channelId);
  }

  private async isOrpheusMember(channelId: string): Promise<boolean> {
    const cached = this.memberships.get(channelId);
    if (cached && Date.now() - cached.checkedAt < MEMBERSHIP_TTL_MS) return cached.member;
    const pending = this.membershipLookups.get(channelId);
    if (pending) return pending;

    const lookup = this.lookUpMembership(channelId)
      .then((member) => {
        this.memberships.set(channelId, { member, checkedAt: Date.now() });
        return member;
      })
      .catch((error) => {
        this.log('could not check whether Orpheus is in this channel', error);
        return false;
      })
      .finally(() => this.membershipLookups.delete(channelId));
    this.membershipLookups.set(channelId, lookup);
    return lookup;
  }

  private async lookUpMembership(channelId: string): Promise<boolean> {
    let cursor = '';
    for (let page = 0; page < MEMBERS_MAX_PAGES; page++) {
      const response = await this.api.userAPI<{
        members?: string[];
        response_metadata?: { next_cursor?: string };
      }>(
        'conversations.members',
        { channel: channelId, limit: String(MEMBERS_PAGE_LIMIT), ...(cursor ? { cursor } : {}) },
        { signal: this.api.signal, rateLimitRetries: 1 },
      );
      if (response.members?.includes(ORPHEUS_USER)) return true;
      cursor = response.response_metadata?.next_cursor ?? '';
      if (!cursor) break;
    }
    return false;
  }

  private async findHaiku(blocks: Block[]): Promise<string[] | null> {
    try {
      const text = blocksToSlackText(blocks);
      // Ruby's String#length counts code points, not UTF-16 units.
      if ([...text].length >= MAX_LENGTH) return null;
      const words = await this.dictionary();
      return findHaiku(text, (word) => dictionaryLookup(words, word));
    } catch (error) {
      this.log('could not check message', error);
      return null;
    }
  }
}
