// Name the private channels Slack will not name, and mention ones you are not
// in. Names can stay local or come from the Flaron index. Synthesized channels
// are layered over Slack's store and the two missing-channel renderers patched.

import { SlickPlugin, type SlackChannel } from '$slick';
import {
  hasExactChannelResult,
  mergeChannelResults,
  normalizeChannelQuery,
  type ChannelResult,
} from './autocomplete.ts';
import { candidatesFor, CHANNEL_ID, type ChannelName } from './flaron.ts';
import * as meta from './meta.ts';

const SHADOW_TTL_MS = 24 * 60 * 60 * 1000;
const MAX_QUERY_LOOKUPS = 5;
const SAVE_DEBOUNCE_MS = 1_000;

type ConfirmedShadow = ChannelName & { ts: number };
type AutocompleteParams = { query?: unknown; [key: string]: unknown };
type TieredResults = ChannelResult[] & { promise?: unknown };
type SlackThunk = (...args: unknown[]) => unknown;
type ThunkCreator<Params> = (params: Params) => SlackThunk;
type BaseChannelProps = {
  id?: string;
  channelName?: string;
  isPrivate?: boolean;
  isMember?: boolean;
  isNonExistent?: boolean;
  isUnknown?: boolean;
};

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

function objectRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : undefined;
}

/**
 * Autocomplete and component patch structure adapted from Taut's MIT-licensed
 * PrivateChannel plugin by Jeremy Stanley.
 */
export default class PrivateChannelMapper extends SlickPlugin<typeof meta.settings> {
  static readonly id = meta.id;
  static readonly pluginName = meta.pluginName;
  static readonly description = meta.description;
  static readonly defaultEnabled = meta.defaultEnabled;
  static readonly settings = meta.settings;

  /** Every Flaron name learned so far; names alone do not prove inaccessibility. */
  private names = new Map<string, ChannelName>();
  /** Names the user chose locally; these never go to Flaron. */
  private localNames = new Map<string, string>();
  /** Only Slack failures or a successful name lookup become added store keys. */
  private shadows = new Map<string, ConfirmedShadow>();
  private askedIds = new Set<string>();
  private askedNames = new Set<string>();
  private pendingIds = new Map<string, Promise<string | undefined>>();
  private saveTimer: ReturnType<typeof setTimeout> | null = null;
  private expiryTimer: ReturnType<typeof setTimeout> | null = null;

  async start() {
    const [storedNames, storedShadows, storedLocalNames] = await Promise.all([
      this.api.storage.get<Record<string, string>>('names', {}),
      this.api.storage.get<Record<string, ConfirmedShadow>>('shadows', {}),
      this.api.storage.get<Record<string, string>>('localNames', {}),
    ]);
    if (this.api.signal.aborted) return;

    const legacyLocalNames = this.legacyLocalNames();
    const localNames = { ...legacyLocalNames, ...storedLocalNames };
    for (const [id, name] of Object.entries(localNames)) {
      if (CHANNEL_ID.test(id) && typeof name === 'string' && name.trim()) this.localNames.set(id, name.trim());
    }
    if (Object.keys(legacyLocalNames).length) {
      void this.api.storage.set('localNames', Object.fromEntries(this.localNames));
    }
    for (const [id, name] of Object.entries(storedNames)) {
      if (CHANNEL_ID.test(id) && typeof name === 'string' && name) this.names.set(id, { name });
    }
    if (this.config.mentions === true) {
      for (const [id, shadow] of Object.entries(storedShadows)) {
        if (!CHANNEL_ID.test(id) || !shadow || typeof shadow.name !== 'string' || typeof shadow.ts !== 'number')
          continue;
        this.names.set(id, { name: shadow.name, previousNames: shadow.previousNames });
        if (Date.now() - shadow.ts < SHADOW_TTL_MS) this.shadows.set(id, shadow);
      }
      this.scheduleExpiry();
    }

    this.api.redux.patchSlice<SlackChannel>(
      'channels',
      (id, channel) => this.channelFor(id, channel),
      () => this.addedChannelIds(),
    );
    this.api.redux.refresh();

    if (this.config.mentions === true) this.patchThunks();
    this.patchChannelRendering();
    this.editLocalNames();
  }

  stop() {
    if (this.saveTimer) clearTimeout(this.saveTimer);
    if (this.expiryTimer) clearTimeout(this.expiryTimer);
    this.saveTimer = null;
    this.expiryTimer = null;
  }

  private channelFor(id: string, channel: SlackChannel | undefined): SlackChannel | undefined {
    // A real channel can replace a shadow before its TTL; Slack always wins.
    if (slackKnowsName(channel)) return channel;
    if (!CHANNEL_ID.test(id)) return channel;

    // An unconfirmed name may fill a stub Slack already gave up on, but it
    // must not create an absent key: Slack still gets a chance to fetch it.
    const record =
      (this.localNames.has(id) ? { name: this.localNames.get(id)! } : undefined) ??
      (this.config.mentions === true ? this.activeShadow(id) : undefined) ??
      (this.config.flaron === true && channel ? this.names.get(id) : undefined);
    if (!record) {
      if (this.config.flaron === true && channel) void this.lookUpName(id);
      return channel;
    }

    return this.api.channels.makeChannelObject({
      id,
      name: record.name,
      isPrivate: true,
      previousNames: record.previousNames,
    });
  }

  private rawChannel(id: string): SlackChannel | undefined {
    // Slack's slice keys live on its prototype. Direct keyed access walks that
    // prototype; Object.keys/Object.entries would incorrectly report it empty.
    const state = objectRecord(this.api.redux.getRawState() as unknown);
    const channels = objectRecord(state?.channels);
    return channels?.[id] as SlackChannel | undefined;
  }

  private activeShadow(id: string): ConfirmedShadow | undefined {
    const shadow = this.shadows.get(id);
    if (!shadow || Date.now() - shadow.ts < SHADOW_TTL_MS) return shadow;
    this.shadows.delete(id);
    this.queueSave();
    return undefined;
  }

  private *activeShadowIds(): Iterable<string> {
    for (const id of this.shadows.keys()) if (this.activeShadow(id)) yield id;
  }

  private *addedChannelIds(): Iterable<string> {
    yield* this.localNames.keys();
    if (this.config.mentions === true) yield* this.activeShadowIds();
  }

  private confirm(id: string, record: ChannelName): boolean {
    if (slackKnowsName(this.rawChannel(id))) return false;
    this.names.set(id, record);
    this.shadows.set(id, { ...record, ts: Date.now() });
    this.scheduleExpiry();
    return true;
  }

  private scheduleExpiry() {
    if (this.expiryTimer) clearTimeout(this.expiryTimer);
    const next = Math.min(...[...this.shadows.values()].map((shadow) => shadow.ts + SHADOW_TTL_MS));
    if (!Number.isFinite(next)) {
      this.expiryTimer = null;
      return;
    }
    this.expiryTimer = setTimeout(
      () => {
        this.expiryTimer = null;
        let removed = false;
        for (const [id, shadow] of this.shadows) {
          if (Date.now() - shadow.ts >= SHADOW_TTL_MS) {
            this.shadows.delete(id);
            removed = true;
          }
        }
        if (removed) this.commit();
        this.scheduleExpiry();
      },
      Math.max(0, next - Date.now()),
    );
  }

  private fetchName(id: string): Promise<string | undefined> {
    const pending = this.pendingIds.get(id);
    if (pending) return pending;
    if (this.askedIds.has(id)) return Promise.resolve(undefined);
    this.askedIds.add(id);

    const request = this.api.main
      .call<string | null>('channel', id)
      .then((name) => (typeof name === 'string' && name ? name : undefined))
      .catch((error) => {
        this.log(`could not resolve ${id}`, error);
        return undefined;
      })
      .finally(() => this.pendingIds.delete(id));
    this.pendingIds.set(id, request);
    return request;
  }

  private async lookUpName(id: string) {
    const name = await this.fetchName(id);
    if (!name || this.api.signal.aborted) return;
    this.names.set(id, { name });
    this.commit();
  }

  /** Slack named these ids as missing, so a Flaron result is safe to layer in. */
  private onMissing(ids: string[]) {
    for (const id of ids) {
      if (!CHANNEL_ID.test(id) || this.activeShadow(id) || slackKnowsName(this.rawChannel(id))) continue;
      const known = this.names.get(id);
      if (known) {
        if (this.confirm(id, known)) this.commit();
      } else {
        void this.verifyById(id);
      }
    }
  }

  private async verifyById(id: string): Promise<boolean> {
    if (this.activeShadow(id) || slackKnowsName(this.rawChannel(id))) return false;
    const name = await this.fetchName(id);
    if (!name || this.api.signal.aborted) return false;
    const record = { name, previousNames: this.names.get(id)?.previousNames };
    if (!this.confirm(id, record)) return false;
    this.commit();
    return true;
  }

  private async resolveByName(query: string): Promise<boolean> {
    const candidates = candidatesFor(
      this.names,
      query,
      (id) => !this.activeShadow(id) && !this.askedIds.has(id) && !slackKnowsName(this.rawChannel(id)),
      MAX_QUERY_LOOKUPS,
    );
    if (candidates.length) {
      const verified = await Promise.all(candidates.map((id) => this.verifyById(id)));
      if (verified.some(Boolean)) return true;
    }

    if (this.askedNames.has(query)) return false;
    this.askedNames.add(query);
    try {
      const id = await this.api.main.call<string | null>('byName', query);
      if (!id || !CHANNEL_ID.test(id) || this.api.signal.aborted || slackKnowsName(this.rawChannel(id))) return false;
      if (!this.confirm(id, { name: query })) return false;
      this.commit();
      return true;
    } catch (error) {
      this.log(`could not resolve #${query}`, error);
      return false;
    }
  }

  private patchThunks() {
    this.api.redux.patchThunk('fetchRawChannelsById', (untypedOriginal) => {
      const original = untypedOriginal as unknown as ThunkCreator<unknown>;
      return (params: unknown) => {
        const thunk = original(params);
        return (...args: unknown[]) =>
          Promise.resolve(thunk(...args)).then((response: unknown) => {
            const missing = objectRecord(response)?.missing;
            if (Array.isArray(missing)) this.onMissing(missing.filter((id): id is string => typeof id === 'string'));
            return response;
          });
      };
    });

    this.api.redux.patchThunk('autocompleteChannels', (untypedOriginal) => {
      const original = untypedOriginal as unknown as ThunkCreator<AutocompleteParams>;
      return (params: AutocompleteParams) => {
        const query = normalizeChannelQuery(params?.query);
        if (!query) return original(params);

        return (...args: unknown[]) =>
          Promise.resolve(original(params)(...args)).then((value: unknown) => {
            if (!Array.isArray(value)) return value;
            const local = value as TieredResults;
            const merged = Promise.resolve(local.promise).then(async (remote: unknown) => {
              const base = (Array.isArray(remote) ? remote : local) as ChannelResult[];
              // Waiting for Slack's complete tier first is the privacy boundary:
              // known exact names never become third-party requests.
              if (hasExactChannelResult(base, query)) return base;
              if (!(await this.resolveByName(query))) return base;

              const rerun = await original(params)(...args);
              return Array.isArray(rerun) ? mergeChannelResults(base, rerun as ChannelResult[]) : base;
            });

            // Slack occasionally freezes its local result array.
            const fresh = local.slice() as TieredResults;
            fresh.promise = merged;
            return fresh;
          });
      };
    });
  }

  private renderMissing(id: string, name: string) {
    const { SvgIcon } = this.api.elements;
    return (
      <span
        className="c-missing_channel--private slick-pcm--flaron"
        data-slick-pcm-id={id}
        title="Double-click to name locally"
      >
        <SvgIcon inline name="lock" />
        {name}
      </span>
    );
  }

  private patchChannelRendering() {
    this.api.patchComponent<BaseChannelProps>('BaseMrkdwnChannel', (Original) => (props) => {
      this.api.redux.usePatchVersion();
      const channel = props.id ? this.api.channels.getCachedChannel(props.id) : undefined;
      const inaccessible =
        props.isNonExistent || props.isUnknown || (props.isPrivate === true && props.isMember !== true);
      if (inaccessible && props.id) {
        return this.renderMissing(props.id, channel?.name || props.channelName || props.id);
      }
      return <Original {...props} />;
    });

    this.api.patchComponent<{ id?: string }>('ListChannelEntity', (Original) => (props) => {
      this.api.redux.usePatchVersion();
      const id = props.id;
      const channel = this.api.redux.useReduxState<SlackChannel | undefined>((state) =>
        id ? state.channels?.[id] : undefined,
      );
      const inaccessible =
        !!channel &&
        (channel.isNonExistent === true ||
          channel.isUnknown === true ||
          (channel.is_private === true && channel.is_member !== true));
      if (inaccessible && id && channel) {
        return this.renderMissing(id, channel.name || id);
      }
      return <Original {...props} />;
    });
  }

  private editLocalNames() {
    const edit = (event: MouseEvent) => {
      const target = event.target instanceof Element ? event.target.closest<HTMLElement>('[data-slick-pcm-id]') : null;
      const id = target?.dataset.slickPcmId;
      if (!id || !CHANNEL_ID.test(id)) return;

      const current = this.localNames.get(id) ?? '';
      const answer = window.prompt(`Local name for ${id} (leave blank to remove)`, current);
      if (answer === null) return;
      const name = answer.trim();
      if (name) this.localNames.set(id, name);
      else this.localNames.delete(id);
      void this.api.storage.set('localNames', Object.fromEntries(this.localNames));
      this.api.redux.refresh();
    };
    document.addEventListener('dblclick', edit);
    this.api.signal.addEventListener('abort', () => document.removeEventListener('dblclick', edit));
  }

  private legacyLocalNames(): Record<string, string> {
    try {
      const value = JSON.parse(localStorage.getItem('slick:pcm:names') ?? '{}') as unknown;
      return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, string>) : {};
    } catch {
      return {};
    }
  }

  /** Repaint immediately, but batch the large maps into one storage write. */
  private commit() {
    this.api.redux.refresh();
    this.queueSave();
  }

  private queueSave() {
    if (this.saveTimer) clearTimeout(this.saveTimer);
    this.saveTimer = setTimeout(() => {
      this.saveTimer = null;
      if (this.api.signal.aborted) return;
      const names = Object.fromEntries([...this.names].map(([id, record]) => [id, record.name]));
      void Promise.all([
        this.api.storage.set('names', names),
        this.api.storage.set('shadows', Object.fromEntries(this.shadows)),
      ]).catch((error) => this.log('could not save channel cache', error));
    }, SAVE_DEBOUNCE_MS);
  }
}
