// Post @channel / @here through the bChannel relay.
//
// v1 addressed Slack by minified module id (`eh+y`, `M9P0`, `Tid6`, `DiPi`) and
// patched fetch/XHR to rewrite the request after Slack had already serialized
// it. Those ids change without warning and fail inside empty catches.
//
// v2 never ships an id. Preflight is named thunks (`getChannelPrefByApi` and
// friends) with `userAPI` as the durable fallback; Block Kit is
// `api.blocks.fromDelta`; the send is intercepted on `prepareAndSendMessage`
// before Slack posts. Failures log. Anything this plugin changes on a channel
// is recorded so it can be put back.

import { SlickPlugin, type ComponentType, type Delta, type SlackMessage } from '$slick';
import {
  broadcastKinds,
  commandOps,
  deltaCandidateKinds,
  isChannelId,
  isTeamId,
  isUserId,
  normalizeRestrictedBroadcasts,
  notificationTextFromBlocks,
  originOf,
  plainTextFromDelta,
  textBroadcastKinds,
} from './broadcast.ts';
import { apiErrorCode, parseWhoCanPost, postingPrefWithBot, prefAllowsBot, slackPropagationDelay } from './ready.ts';
import * as meta from './meta.ts';

type SendArgs = {
  delta: Delta;
  channelId?: string;
  threadTs?: string;
  draftId?: string;
  fileIds?: unknown[];
  pendingFileIds?: unknown[];
};

type SendProps = {
  prepareAndSendMessage: (args: SendArgs) => Promise<unknown>;
  channelId?: string;
  teamId?: string;
};

type AutocompleteProps = { includeAllBroadcastKeywords?: boolean };

type Staged = { commandText: string; token: string; setup?: { botUserId?: string } };

type Upload = {
  sourceId: string;
  name: string;
  slot: string;
  descriptor: { sourceId: string; name: string; slot: string; mimeType: string; size: number };
  loadBlob: () => Promise<Blob>;
};

type Intent = {
  version: 1;
  channelId: string;
  teamId?: string;
  text: string;
  blocks: unknown[];
  threadTs?: string;
  files?: Upload['descriptor'][];
  action?: 'delete';
  ts?: string;
};

type Change = { at: number; channelId: string; action: string };

const BCHANNEL_BOT = 'B0BJDMND6HX';
const TOKEN = /^[A-Za-z0-9_-]{43}$/;
const FILE_ID = /^F[A-Z0-9]+$/;
const IMAGE_TYPES = new Set(['image/jpeg', 'image/png', 'image/gif', 'image/webp']);
const GET_PREF = ['getChannelPrefByApi', 'getChannelPref'] as const;
const SET_PREF = ['setChannelPrefsByApi', 'setChannelPrefs'] as const;
const INVITE = ['inviteUsersToChannelByApi', 'inviteUsersToChannel'] as const;
const COMMAND_ERRORS: Record<string, string> = {
  dispatch_failed: "Slack couldn't reach bChannel. Check that the bChannel app is installed and available.",
  unknown_command: "The /bchannel command isn't installed in this workspace. Ask an admin to install bChannel.",
  command_not_found: "The /bchannel command isn't installed in this workspace. Ask an admin to install bChannel.",
  invalid_auth: 'Your Slack session is out of date. Sign in to Slack again, then retry.',
  not_authed: 'Slack needs you to sign in again before bChannel can send this message.',
  account_inactive: 'Your Slack account is inactive, so this message could not be sent.',
  team_access_not_granted: "bChannel isn't installed for this workspace. Ask an admin to install it.",
  ratelimited: 'Slack is receiving too many commands right now. Wait a moment and retry.',
};

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

function sliceKeys(object: object | undefined): string[] {
  if (!object) return [];
  const own = Object.keys(object);
  const proto = Object.getPrototypeOf(object);
  const extra = proto && proto !== Object.prototype ? Object.keys(proto) : [];
  return extra.length ? [...own, ...extra] : own;
}

function requestUrl(input: RequestInfo | URL): string {
  if (typeof input === 'string') return input;
  if (input instanceof URL) return input.href;
  return input.url;
}

function bodyRecord(body: BodyInit | null | undefined): Record<string, string> | null {
  if (!body) return null;
  if (body instanceof URLSearchParams || body instanceof FormData) {
    const out: Record<string, string> = {};
    for (const [key, value] of body.entries()) if (typeof value === 'string') out[key] = value;
    return out;
  }
  if (typeof body !== 'string') return null;
  if (body.trim().startsWith('{')) {
    try {
      const parsed = JSON.parse(body) as unknown;
      return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? (parsed as Record<string, string>) : null;
    } catch {
      return null;
    }
  }
  return Object.fromEntries(new URLSearchParams(body));
}

function jsonArray(value: unknown): unknown[] {
  if (Array.isArray(value)) return value;
  if (typeof value !== 'string') return [];
  try {
    const parsed = JSON.parse(value) as unknown;
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export default class BChannel extends SlickPlugin<typeof meta.settings> {
  static readonly id = meta.id;
  static readonly pluginName = meta.pluginName;
  static readonly description = meta.description;
  static readonly defaultEnabled = meta.defaultEnabled;
  static readonly settings = meta.settings;
  static readonly liveSettings = ['serviceUrl'];

  private nativeFetch: typeof fetch | null = null;
  private readonly readyChannels = new Map<string, number>();
  private readonly handoffs = new Map<string, Promise<unknown>>();
  private readonly changes: Change[] = [];
  private readonly thunkNames = new Map<string, string>();
  private readonly missingThunks = new Set<string>();
  private pruneTimer: ReturnType<typeof setInterval> | null = null;

  start() {
    this.installFetch();
    this.patchSend();
    this.patchAutocomplete();
    this.pruneTimer = setInterval(() => this.prune(), 5 * 60_000);
    this.log('intercepting @channel / @here sends');
    void this.probeThunks();
  }

  stop() {
    if (this.pruneTimer) clearInterval(this.pruneTimer);
    this.pruneTimer = null;
    if (this.nativeFetch) window.fetch = this.nativeFetch;
    this.nativeFetch = null;
    if (this.changes.length) this.log('Slack state this session changed:', this.changes);
  }

  private origin(): string {
    return originOf(this.config.serviceUrl);
  }

  private patchSend() {
    for (const name of ['MessagePaneInput', 'InputContainer'] as const) {
      this.api.patchComponent<SendProps>(name, (Original) => (props) => this.renderSend(Original, props));
    }
  }

  private renderSend(Original: ComponentType<SendProps>, props: SendProps) {
    const send = (args: SendArgs) => this.onSend(props, args);
    return this.api.react.createElement(Original, { ...props, prepareAndSendMessage: send });
  }

  private patchAutocomplete() {
    this.api.patchComponent<AutocompleteProps>('TextyAutocomplete', (Original) => (props) => {
      const channelId = this.api.channels.getCurrentChannelId();
      const include = isChannelId(channelId) ? true : props.includeAllBroadcastKeywords;
      return this.api.react.createElement(Original, { ...props, includeAllBroadcastKeywords: include });
    });
  }

  private installFetch() {
    const original = window.fetch.bind(window);
    this.nativeFetch = original;
    window.fetch = (input: RequestInfo | URL, init?: RequestInit) => this.interceptFetch(original, input, init);
  }

  private interceptFetch(original: typeof fetch, input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
    const url = requestUrl(input);
    const body = init?.body;
    if (url.includes('/api/chat.delete')) {
      const candidate = this.deleteCandidate(body);
      if (candidate && this.isBChannelMessage(candidate.channelId, candidate.ts)) {
        return this.deleteAsResponse(candidate).then((response) => response ?? original(input, init));
      }
    }
    if (url.includes('/api/chat.postMessage') || url.includes('/api/files.completeUploadExternal')) {
      const candidate = url.includes('completeUploadExternal') ? this.fileCandidate(body) : this.postCandidate(body);
      if (candidate?.requiresHandoff) return this.handoffAsResponse(candidate);
    }
    return original(input, init);
  }

  private async onSend(props: SendProps, args: SendArgs): Promise<unknown> {
    const channelId = String(args.channelId || props.channelId || '');
    if (!isChannelId(channelId) || !deltaCandidateKinds(args.delta).size) {
      return props.prepareAndSendMessage(args);
    }

    const dedupe = `${channelId}:${args.threadTs || ''}:${args.draftId || ''}:${JSON.stringify(args.delta.ops)}`;
    const existing = this.handoffs.get(dedupe);
    if (existing) return existing;

    const run = this.handoffComposer(props, args, channelId);
    this.handoffs.set(dedupe, run);
    try {
      return await run;
    } finally {
      if (this.handoffs.get(dedupe) === run) this.handoffs.delete(dedupe);
    }
  }

  private async handoffComposer(props: SendProps, args: SendArgs, channelId: string): Promise<unknown> {
    try {
      const nativeBlocks = await this.api.blocks.fromDelta(args.delta);
      const restricted = new Set<'channel' | 'here'>();
      const blocks = normalizeRestrictedBroadcasts(nativeBlocks, false, restricted) as unknown[];
      if (!broadcastKinds(blocks).size) {
        throw new Error('Slack could not recognize the @channel or @here mention in this message.');
      }
      const uploads = await this.uploadsFor(args);
      const withFiles = this.blocksWithUploads(blocks, uploads);
      const intent: Intent = {
        version: 1,
        channelId,
        text: notificationTextFromBlocks(withFiles, plainTextFromDelta(args.delta)),
        blocks: withFiles,
        ...(this.teamId(props.teamId) ? { teamId: this.teamId(props.teamId) } : {}),
        ...(typeof args.threadTs === 'string' && args.threadTs ? { threadTs: args.threadTs } : {}),
        ...(uploads.length ? { files: uploads.map((upload) => upload.descriptor) } : {}),
      };

      let staged = await this.stageIntent(intent);
      if (await this.ensureReady(staged, channelId)) {
        await this.discardIntent(staged.token);
        staged = await this.stageIntent(intent);
      }

      const result = await props.prepareAndSendMessage({
        ...args,
        delta: this.commandDelta(args.delta, staged.commandText),
        fileIds: [],
        pendingFileIds: [],
      });
      await this.uploadStagedFiles(staged.token, uploads);
      return result;
    } catch (error) {
      const message = error instanceof Error ? error.message : 'bChannel is unavailable right now.';
      this.log('send failed', error);
      void this.api.modal.alert({ title: "This message wasn't sent", body: message });
      throw error;
    }
  }

  private commandDelta(delta: Delta, commandText: string): Delta {
    const DeltaClass = delta.constructor as new (ops?: unknown[]) => Delta;
    return new DeltaClass(commandOps(commandText));
  }

  private teamId(from?: string): string {
    if (isTeamId(from)) return from;
    const boot = this.api.redux.getRawState()?.bootData;
    const id = boot?.team_id ?? boot?.teamId;
    return isTeamId(id) ? id : '';
  }

  private async stageIntent(intent: Intent): Promise<Staged> {
    const response = await fetch(`${this.origin()}/slick/intents`, {
      method: 'POST',
      credentials: 'omit',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(intent),
      signal: AbortSignal.timeout(15_000),
    });
    const staged = (await response.json().catch(() => ({}))) as Staged & { message?: string };
    if (!response.ok || typeof staged.commandText !== 'string' || !TOKEN.test(String(staged.token || ''))) {
      throw new Error(String(staged.message || "bChannel couldn't prepare this message."));
    }
    return staged;
  }

  private async discardIntent(token: string) {
    if (!TOKEN.test(token)) return;
    await fetch(`${this.origin()}/slick/intents/${encodeURIComponent(token)}`, {
      method: 'DELETE',
      credentials: 'omit',
      signal: AbortSignal.timeout(5_000),
    }).catch((error) => this.log('could not discard staged intent', error));
  }

  private botUserId(staged: Staged): string {
    const id = String(staged.setup?.botUserId || '');
    return isUserId(id) ? id : '';
  }

  private async ensureReady(staged: Staged, channelId: string): Promise<boolean> {
    const botUserId = this.botUserId(staged);
    if (!botUserId || !isChannelId(channelId)) return false;
    const cacheKey = `${botUserId}:${channelId}`;
    if (Date.now() - (this.readyChannels.get(cacheKey) || 0) < 60_000) return false;

    let changed = false;
    let member = false;
    try {
      const membership = await this.ensureMember(channelId, botUserId);
      member = membership.member;
      if (membership.changed) changed = true;
    } catch (error) {
      this.log('membership preflight failed', { channelId, error: apiErrorCode(error) });
      return changed;
    }
    if (!member) return changed;

    try {
      if (await this.ensurePref(channelId, botUserId)) changed = true;
    } catch (error) {
      this.log('who_can_post preflight failed', { channelId, error: apiErrorCode(error) });
    }

    if (changed) await sleep(2_000);
    const pref = await this.getPref(channelId).catch(() => undefined);
    if (member && prefAllowsBot(pref, botUserId)) this.readyChannels.set(cacheKey, Date.now());
    return changed;
  }

  private async ensureMember(channelId: string, botUserId: string): Promise<{ member: boolean; changed: boolean }> {
    let changed = false;
    for (let attempt = 1; attempt <= 10; attempt++) {
      if (this.api.signal.aborted) return { member: false, changed };
      const result = await this.invite(channelId, botUserId);
      if (result === 'already') return { member: true, changed };
      if (result === 'invited') {
        changed = true;
        this.record(channelId, `invited ${botUserId}`);
      }
      await sleep(slackPropagationDelay(attempt));
    }
    return { member: false, changed };
  }

  private async ensurePref(channelId: string, botUserId: string): Promise<boolean> {
    const current = await this.getPref(channelId);
    if (prefAllowsBot(current, botUserId)) return false;
    const whoCanPost = postingPrefWithBot(current, botUserId);
    if (!whoCanPost) return false;
    await this.setPref(channelId, whoCanPost);
    this.record(channelId, `who_can_post += ${botUserId}`);
    for (let attempt = 1; attempt <= 10; attempt++) {
      if (this.api.signal.aborted) return true;
      await sleep(slackPropagationDelay(attempt));
      const refreshed = await this.getPref(channelId);
      if (prefAllowsBot(refreshed, botUserId)) return true;
    }
    this.log('who_can_post write did not become visible after retries', { channelId });
    return true;
  }

  private async invite(channelId: string, botUserId: string): Promise<'already' | 'invited'> {
    try {
      await this.dispatchFirst([...INVITE], {
        channelId,
        users: botUserId,
        reason: 'slick-bchannel-private-channel-setup',
      });
      return 'invited';
    } catch (error) {
      const code = apiErrorCode(error);
      if (code === 'already_in_channel' || /already_in_channel/.test(code)) return 'already';
      if (/not found|missing thunk/i.test(code)) {
        try {
          await this.api.userAPI(
            'conversations.invite',
            { channel: channelId, users: botUserId },
            { signal: this.api.signal },
          );
          return 'invited';
        } catch (fallback) {
          const fallbackCode = apiErrorCode(fallback);
          if (fallbackCode === 'already_in_channel' || /already_in_channel/.test(fallbackCode)) return 'already';
          throw fallback;
        }
      }
      throw error;
    }
  }

  private async getPref(channelId: string) {
    try {
      const raw = await this.dispatchFirst([...GET_PREF], {
        channelId,
        prefName: 'who_can_post',
        reason: 'slick-bchannel-check-posting-permissions',
      });
      return parseWhoCanPost(raw);
    } catch (error) {
      this.log('getChannelPref thunk missing or failed; trying conversations.getPrefs', apiErrorCode(error));
      try {
        return parseWhoCanPost(
          await this.api.userAPI('conversations.getPrefs', { channel: channelId }, { signal: this.api.signal }),
        );
      } catch (prefsError) {
        this.log('conversations.getPrefs failed; trying getConversationPrefs', apiErrorCode(prefsError));
        return parseWhoCanPost(
          await this.api.userAPI(
            'conversations.getConversationPrefs',
            { channel: channelId },
            { signal: this.api.signal },
          ),
        );
      }
    }
  }

  private async setPref(channelId: string, whoCanPost: string) {
    const newPrefs = JSON.stringify({ who_can_post: whoCanPost });
    try {
      await this.dispatchFirst([...SET_PREF], {
        channelId,
        newPrefs,
        reason: 'slick-bchannel-add-bot-posting-permission',
      });
      return;
    } catch (error) {
      this.log('setChannelPrefs thunk missing or failed; trying conversations.setPrefs', apiErrorCode(error));
      try {
        await this.api.userAPI(
          'conversations.setPrefs',
          { channel: channelId, prefs: newPrefs },
          { signal: this.api.signal },
        );
      } catch (prefsError) {
        this.log('conversations.setPrefs failed; trying setConversationPrefs', apiErrorCode(prefsError));
        await this.api.userAPI(
          'conversations.setConversationPrefs',
          { channel: channelId, prefs: newPrefs },
          { signal: this.api.signal },
        );
      }
    }
  }

  private async dispatchFirst(names: string[], args: Record<string, unknown>): Promise<unknown> {
    const key = names[0];
    if (this.missingThunks.has(key)) throw new Error(`missing thunks: ${names.join('|')}`);

    const remembered = names
      .map((name) => this.thunkNames.get(name))
      .find((name) => name && this.api.redux.getThunkCreator(name));
    if (remembered) return this.api.redux.dispatchThunk(remembered, args);

    const deadline = Date.now() + 2_500;
    while (Date.now() < deadline) {
      if (this.api.signal.aborted) throw new Error('bChannel stopped');
      for (const name of names) {
        if (this.api.redux.getThunkCreator(name)) {
          this.thunkNames.set(key, name);
          this.log(`using thunk ${name}`);
          return this.api.redux.dispatchThunk(name, args);
        }
      }
      await sleep(100);
    }
    this.missingThunks.add(key);
    throw new Error(`missing thunks: ${names.join('|')}`);
  }

  private async probeThunks() {
    await sleep(2_500);
    if (this.api.signal.aborted) return;
    const groups = { getPref: GET_PREF, setPref: SET_PREF, invite: INVITE };
    for (const [role, names] of Object.entries(groups)) {
      const found = names.find((name) => this.api.redux.getThunkCreator(name));
      if (found) {
        this.thunkNames.set(names[0], found);
        this.log(`${role} -> ${found}`);
      } else {
        this.log(`${role} thunk not in the registry yet; will try userAPI if Slack asks (${names.join('|')})`);
      }
    }
  }

  private record(channelId: string, action: string) {
    const entry = { at: Date.now(), channelId, action };
    this.changes.push(entry);
    this.log('changed Slack state', entry);
  }

  private isBChannelMessage(channelId: string, ts: string): boolean {
    const msg = this.api.messages.getRawMessage(channelId, ts) as SlackMessage & {
      metadata?: { event_type?: string };
      bot_id?: string;
    };
    return msg?.metadata?.event_type === 'bchannel_message' || msg?.bot_id === BCHANNEL_BOT;
  }

  private payloadFrom(text: string, rawBlocks: unknown) {
    const blocks = jsonArray(rawBlocks);
    const restricted = new Set<'channel' | 'here'>();
    const normalized = normalizeRestrictedBroadcasts(blocks, false, restricted) as unknown[];
    const kinds = broadcastKinds(normalized);
    if (!normalized.length) textBroadcastKinds(text, kinds);
    return { blocks: normalized, kinds, requiresHandoff: restricted.size > 0 };
  }

  private postCandidate(body: BodyInit | null | undefined) {
    const values = bodyRecord(body);
    if (!values) return null;
    const text = typeof values.text === 'string' ? values.text : '';
    const payload = this.payloadFrom(text, values.blocks);
    const channelId = String(values.channel || '');
    if (!payload.kinds.size || !isChannelId(channelId)) return null;
    return {
      requiresHandoff: payload.requiresHandoff,
      intent: {
        version: 1 as const,
        channelId,
        text,
        blocks: payload.blocks,
        ...(typeof values.thread_ts === 'string' ? { threadTs: values.thread_ts } : {}),
      },
    };
  }

  private fileCandidate(body: BodyInit | null | undefined) {
    const values = bodyRecord(body);
    if (!values) return null;
    const text = String(values.initial_comment || values.text || '');
    const payload = this.payloadFrom(text, values.blocks);
    const channelId = String(values.channel_id || values.channel || '');
    if (!payload.kinds.size || !isChannelId(channelId)) return null;
    return {
      requiresHandoff: payload.requiresHandoff,
      intent: {
        version: 1 as const,
        channelId,
        text,
        blocks: payload.blocks,
        ...(typeof values.thread_ts === 'string' ? { threadTs: values.thread_ts } : {}),
      },
    };
  }

  private deleteCandidate(body: BodyInit | null | undefined) {
    const values = bodyRecord(body);
    if (!values) return null;
    const channelId = String(values.channel || '');
    const ts = String(values.ts || '');
    if (!isChannelId(channelId) || !/^\d{1,16}\.\d{1,16}$/.test(ts)) return null;
    return { channelId, ts, teamId: this.teamId() };
  }

  private async handoffAsResponse(candidate: { intent: Intent; requiresHandoff: boolean }): Promise<Response> {
    try {
      let staged = await this.stageIntent(candidate.intent);
      if (await this.ensureReady(staged, candidate.intent.channelId)) {
        await this.discardIntent(staged.token);
        staged = await this.stageIntent(candidate.intent);
      }
      await this.api.userAPI(
        'chat.command',
        { channel: candidate.intent.channelId, command: '/bchannel', text: staged.commandText },
        { signal: this.api.signal },
      );
      return new Response(JSON.stringify({ ok: true, channel: candidate.intent.channelId }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    } catch (error) {
      const code = apiErrorCode(error);
      this.log('fetch handoff failed', code, error);
      void this.api.modal.alert({
        title: "This message wasn't sent",
        body: COMMAND_ERRORS[code] || `Slack couldn't hand this message to bChannel (${code}).`,
      });
      return new Response(JSON.stringify({ ok: false, error: 'restricted_action' }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }
  }

  private async deleteAsResponse(candidate: {
    channelId: string;
    ts: string;
    teamId: string;
  }): Promise<Response | null> {
    try {
      const staged = await this.stageIntent({
        version: 1,
        action: 'delete',
        channelId: candidate.channelId,
        ts: candidate.ts,
        text: '',
        blocks: [],
        ...(candidate.teamId ? { teamId: candidate.teamId } : {}),
      });
      await this.api.userAPI(
        'chat.command',
        { channel: candidate.channelId, command: '/bchannel', text: staged.commandText },
        { signal: this.api.signal },
      );
      return new Response(JSON.stringify({ ok: true, channel: candidate.channelId, ts: candidate.ts }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    } catch (error) {
      this.log('delete handoff failed', error);
      return null;
    }
  }

  private async uploadsFor(args: SendArgs): Promise<Upload[]> {
    const persisted = new Set((args.fileIds ?? []).map(String).filter((id) => FILE_ID.test(id)));
    const pendingIds = new Set((args.pendingFileIds ?? []).map(String));
    if (!persisted.size && !pendingIds.size) return [];

    const state = this.api.redux.getRawState() ?? {};
    const pending = state.pendingFileUploads as
      | Record<string, { persistedFileId?: string; file?: Blob; name?: string }>
      | undefined;
    const files = state.files as
      | Record<
          string,
          {
            url_private_download?: string;
            url_private?: string;
            name?: string;
            title?: string;
            mimetype?: string;
            size?: number;
            mode?: string;
            is_deleted?: boolean;
          }
        >
      | undefined;
    const uploads: Upload[] = [];
    const seen = new Set<string>();

    const add = (
      sourceId: string,
      nameHint: unknown,
      mimeTypeValue: unknown,
      sizeValue: unknown,
      loadBlob: () => Promise<Blob>,
    ) => {
      if (seen.has(sourceId)) return;
      const name = String(nameHint || 'attachment').slice(0, 255);
      const mimeType = String(mimeTypeValue || 'application/octet-stream').toLowerCase();
      const size = Number(sizeValue || 0);
      if (!IMAGE_TYPES.has(mimeType)) {
        throw new Error('bChannel can only send image attachments. Remove the other files and try again.');
      }
      if (!Number.isSafeInteger(size) || size <= 0) return;
      seen.add(sourceId);
      const slot = crypto.randomUUID();
      uploads.push({
        sourceId,
        name,
        slot,
        loadBlob,
        descriptor: { sourceId, name, slot, mimeType, size },
      });
    };

    for (const pendingId of sliceKeys(pending)) {
      const entry = pending?.[pendingId];
      const persistedId = String(entry?.persistedFileId || '');
      if (!pendingIds.has(pendingId) && !persisted.has(persistedId)) continue;
      const sourceId = FILE_ID.test(persistedId)
        ? persistedId
        : `FSLICK${crypto.randomUUID().replaceAll('-', '').toUpperCase()}`;
      const file = entry?.file;
      if (file instanceof Blob)
        add(sourceId, (file as File).name || entry?.name, file.type, file.size, async () => file);
    }

    for (const persistedId of persisted) {
      if (seen.has(persistedId)) continue;
      const file = files?.[persistedId];
      const privateUrl = String(file?.url_private_download || file?.url_private || '');
      let parsed: URL | undefined;
      try {
        parsed = new URL(privateUrl);
      } catch {}
      const trusted =
        parsed?.protocol === 'https:' && (parsed.hostname === 'slack.com' || parsed.hostname.endsWith('.slack.com'));
      if (!file || file.mode === 'tombstone' || file.is_deleted === true || !trusted) continue;
      const name = file.name || file.title || 'this image';
      add(persistedId, name, file.mimetype, file.size, () =>
        this.downloadImage(privateUrl, name, file.mimetype, file.size),
      );
    }

    if (persisted.size && uploads.length !== persisted.size) {
      throw new Error(
        'Slack no longer has the bytes for one or more attachments. Remove and attach those files again.',
      );
    }
    return uploads;
  }

  private async downloadImage(url: string, name: string, expectedMime: unknown, expectedSize: unknown): Promise<Blob> {
    const response = await fetch(url, {
      method: 'GET',
      credentials: 'include',
      redirect: 'follow',
      signal: AbortSignal.timeout(120_000),
    });
    if (!response.ok) throw new Error(`Slack couldn't retrieve ${name}.`);
    const blob = await response.blob();
    const mimeType = String(blob.type || expectedMime).toLowerCase();
    if (!IMAGE_TYPES.has(mimeType) || blob.size !== Number(expectedSize || 0)) {
      throw new Error('Slack returned attachment bytes that did not match the selected image.');
    }
    return blob;
  }

  private blocksWithUploads(blocks: unknown[], uploads: Upload[]): unknown[] {
    if (!uploads.length) return blocks;
    const next = [...blocks] as Array<Record<string, unknown>>;
    let section: { type?: string; elements?: unknown[] } | undefined;
    for (const block of next) {
      if (block?.type !== 'rich_text' || !Array.isArray(block.elements)) continue;
      section = (block.elements as Array<{ type?: string; elements?: unknown[] }>).find(
        (element) => element?.type === 'rich_text_section' && Array.isArray(element.elements),
      );
      if (section) break;
    }
    if (!section) {
      section = { type: 'rich_text_section', elements: [] };
      next.push({ type: 'rich_text', elements: [section] });
    }
    section.elements ??= [];
    for (const upload of uploads) {
      section.elements.push({ type: 'file', file_id: upload.sourceId, text: upload.name });
    }
    return next;
  }

  private async uploadStagedFiles(token: string, uploads: Upload[]) {
    for (const upload of uploads) {
      const blob = await upload.loadBlob();
      if (!(blob instanceof Blob) || blob.size !== upload.descriptor.size) {
        throw new Error('Slack returned an incomplete attachment.');
      }
      let lastFailure = `bChannel couldn't upload ${upload.name}.`;
      for (let attempt = 1; attempt <= 10; attempt++) {
        if (this.api.signal.aborted) throw new Error('bChannel stopped');
        try {
          const response = await fetch(
            `${this.origin()}/slick/intents/${encodeURIComponent(token)}/files/${upload.slot}`,
            {
              method: 'PUT',
              credentials: 'omit',
              headers: { 'content-type': upload.descriptor.mimeType },
              body: blob,
              signal: AbortSignal.timeout(120_000),
            },
          );
          if (response.ok) {
            lastFailure = '';
            break;
          }
          const failure = (await response.json().catch(() => ({}))) as { message?: string };
          lastFailure = String(failure.message || lastFailure);
          if (attempt < 10 && (response.status === 404 || response.status === 409 || response.status === 429)) {
            await sleep(slackPropagationDelay(attempt));
            continue;
          }
          throw new Error(lastFailure);
        } catch (error) {
          if (attempt >= 10) throw error instanceof Error ? error : new Error(lastFailure);
          await sleep(slackPropagationDelay(attempt));
        }
      }
      if (lastFailure) throw new Error(lastFailure);
    }
  }

  private prune() {
    const now = Date.now();
    for (const [key, at] of this.readyChannels) if (now - at >= 60_000) this.readyChannels.delete(key);
  }
}
