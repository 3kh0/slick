(function () {
  'use strict';

  if (window.__slickBChannel) return;

  const POST_MESSAGE_RE = /\/api\/chat\.postMessage(?:[/?#]|$)/;
  const COMPLETE_UPLOAD_RE = /\/api\/files\.completeUploadExternal(?:[/?#]|$)/;
  const IMAGE_TYPES = new Set(['image/jpeg', 'image/png', 'image/gif', 'image/webp']);
  const DENIED_BROADCASTS = new Set(['restricted_action']);
  const COMPOSER_SELECTOR = [
    '[data-qa="texty_input"][contenteditable="true"]',
    '[data-qa="message_input"][contenteditable="true"]',
    '[data-qa="message-input"][contenteditable="true"]',
    '.c-wysiwyg_container [contenteditable="true"][role="textbox"]',
    '.p-message_input [contenteditable="true"][role="textbox"]',
    '.p-threads_footer [contenteditable="true"][role="textbox"]',
  ].join(',');

  const handled = new Map();
  const handoffsInFlight = new Map();
  const readyChannels = new Map();
  const setupCache = new Map();
  const readinessChecksInFlight = new Map();
  const managedChannels = new Map();
  const READY_CHANNEL_TTL_MS = 60_000;
  const MANAGED_CHANNEL_TTL_MS = 5 * 60_000;
  const composerState = new WeakMap();
  const paneState = new WeakMap();
  const nativeFetch = window.fetch;
  window.__slickBChannel = true;
  let slackRequire;
  let slackSerializer;

  function serviceUrl() {
    const configured = String(window.__slickPluginSettings?.bChannel?.serviceUrl || 'https://bc.deployor.dev').trim();
    try {
      const url = new URL(configured);
      if (
        url.protocol === 'https:' ||
        (url.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(url.hostname))
      ) {
        return url.origin;
      }
    } catch (error) {}
    return 'https://bc.deployor.dev';
  }

  async function preflightBotId(teamId) {
    if (!/^[TE][A-Z0-9]+$/.test(String(teamId || ''))) return '';
    const cached = setupCache.get(teamId);
    if (cached && cached.expiresAt > Date.now()) return cached.botUserId;
    try {
      const response = await nativeFetch.call(window, `${serviceUrl()}/slick/preflight`, {
        method: 'POST',
        credentials: 'omit',
        headers: { 'content-type': 'application/x-www-form-urlencoded;charset=UTF-8' },
        body: new URLSearchParams({ teamId }),
        signal: AbortSignal.timeout(5_000),
      });
      const result = await response.json().catch(() => ({}));
      const botUserId = response.ok && /^U[A-Z0-9]+$/.test(String(result?.setup?.botUserId || ''))
        ? String(result.setup.botUserId)
        : '';
      setupCache.set(teamId, {
        botUserId,
        expiresAt: Date.now() + (botUserId ? 5 * 60_000 : 30_000),
      });
      return botUserId;
    } catch (error) {
      return '';
    }
  }

  async function warmChannelReadiness(teamId, channelId, store) {
    if (!store?.dispatch || !store?.getState || !isChannelConversation(channelId)) return;
    const botUserId = await preflightBotId(teamId);
    if (!botUserId) return;
    const cacheKey = `${botUserId}:${channelId}`;
    if (Date.now() - (readyChannels.get(cacheKey) || 0) < READY_CHANNEL_TTL_MS) return;
    if (readinessChecksInFlight.has(cacheKey)) return readinessChecksInFlight.get(cacheKey);
    const check = (async () => {
      try {
        const runtimeRequire = getSlackRequire();
        const membership = await runtimeRequire('eh+y').qY(store.dispatch, store.getState, channelId, [botUserId]);
        if (membership?.[botUserId] !== true) return;
        const current = await store.dispatch(
          runtimeRequire('M9P0').Kn({
            channelId,
            prefName: 'who_can_post',
            reason: 'slick-bchannel-preflight-posting-permissions',
          }),
        );
        if (prefAllowsBot(current, botUserId)) readyChannels.set(cacheKey, Date.now());
      } catch (error) {}
    })();
    readinessChecksInFlight.set(cacheKey, check);
    try {
      await check;
    } finally {
      if (readinessChecksInFlight.get(cacheKey) === check) readinessChecksInFlight.delete(cacheKey);
    }
  }

  function requestUrl(input) {
    return typeof input === 'string' ? input : (input && input.url) || String(input);
  }

  function bodyRecord(body) {
    if (!body) return null;
    if (body instanceof URLSearchParams || body instanceof FormData) {
      const out = {};
      for (const [key, value] of body.entries()) if (typeof value === 'string') out[key] = value;
      return out;
    }
    if (typeof body !== 'string') return null;
    if (body.trim().startsWith('{')) {
      try {
        const parsed = JSON.parse(body);
        return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : null;
      } catch (error) {
        return null;
      }
    }
    return Object.fromEntries(new URLSearchParams(body));
  }

  function jsonArray(value) {
    if (Array.isArray(value)) return value;
    if (typeof value !== 'string') return [];
    try {
      const parsed = JSON.parse(value);
      return Array.isArray(parsed) ? parsed : [];
    } catch (error) {
      return [];
    }
  }

  const MIME_TYPES = {
    apng: 'image/apng',
    avif: 'image/avif',
    gif: 'image/gif',
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    png: 'image/png',
    svg: 'image/svg+xml',
    webp: 'image/webp',
    mp3: 'audio/mpeg',
    m4a: 'audio/mp4',
    wav: 'audio/wav',
    mp4: 'video/mp4',
    webm: 'video/webm',
    mov: 'video/quicktime',
    pdf: 'application/pdf',
    txt: 'text/plain',
    csv: 'text/csv',
    json: 'application/json',
    zip: 'application/zip',
  };

  function inferredMimeType(name) {
    const ext = String(name).toLowerCase().split('.').pop();
    return MIME_TYPES[ext] || 'application/octet-stream';
  }

  function imageMimeType(blob, name) {
    const mimeType = String(blob?.type || inferredMimeType(name)).toLowerCase();
    if (!IMAGE_TYPES.has(mimeType)) {
      throw new Error('bChannel can only send image attachments. Remove the other files and try again.');
    }
    return mimeType;
  }

  function broadcastKinds(value, out) {
    if (Array.isArray(value)) {
      for (const item of value) broadcastKinds(item, out);
      return out;
    }
    if (!value || typeof value !== 'object') return out;
    if (value.type === 'broadcast' && (value.range === 'channel' || value.range === 'here')) out.add(value.range);
    if (value.type === 'mrkdwn' && typeof value.text === 'string') textBroadcastKinds(value.text, out);
    for (const nested of Object.values(value)) broadcastKinds(nested, out);
    return out;
  }

  function textBroadcastKinds(value, out) {
    for (const match of String(value || '').matchAll(/<!(channel|here)(?:\|[^>]*)?>|(^|[^\w])@(channel|here)\b/gim)) {
      const kind = match[1] || match[3];
      if (kind === 'channel' || kind === 'here') out.add(kind);
    }
    return out;
  }

  function normalizeRestrictedBroadcasts(value, inCode = false, found = new Set()) {
    if (Array.isArray(value)) {
      return value.flatMap((item) => {
        const normalized = normalizeRestrictedBroadcasts(item, inCode, found);
        return Array.isArray(normalized) ? normalized : [normalized];
      });
    }
    if (!value || typeof value !== 'object') return value;

    const code = inCode || value.type === 'rich_text_preformatted' || value.style?.code === true;
    if (!code && value.type === 'text' && typeof value.text === 'string') {
      const matches = composerMentionMatches(value.text);
      if (matches.length) {
        const pieces = [];
        let cursor = 0;
        for (const match of matches) {
          if (match.start > cursor) pieces.push({ ...value, text: value.text.slice(cursor, match.start) });
          pieces.push({ type: 'broadcast', range: match.kind });
          found.add(match.kind);
          cursor = match.end;
        }
        if (cursor < value.text.length) pieces.push({ ...value, text: value.text.slice(cursor) });
        return pieces;
      }
    }

    const normalized = {};
    for (const [key, nested] of Object.entries(value)) {
      normalized[key] = normalizeRestrictedBroadcasts(nested, code, found);
    }
    return normalized;
  }

  function normalizedBroadcastPayload(blocks, text) {
    const restrictedKinds = new Set();
    const normalizedBlocks = normalizeRestrictedBroadcasts(blocks, false, restrictedKinds);
    if (!blocks.length && !/<!(?:channel|here)(?:\|[^>]*)?>/i.test(text)) {
      textBroadcastKinds(text, restrictedKinds);
    }
    const kinds = broadcastKinds(normalizedBlocks, new Set());
    if (!normalizedBlocks.length) textBroadcastKinds(text, kinds);
    return {
      blocks: normalizedBlocks,
      kinds,
      requiresHandoff: restrictedKinds.size > 0,
    };
  }

  function fileReferences(value, out = new Map()) {
    if (Array.isArray(value)) {
      for (const item of value) fileReferences(item, out);
      return out;
    }
    if (!value || typeof value !== 'object') return out;
    if (value.type === 'file' && /^F[A-Z0-9]+$/.test(String(value.file_id || ''))) {
      out.set(String(value.file_id), String(value.text || ''));
    }
    for (const nested of Object.values(value)) fileReferences(nested, out);
    return out;
  }

  function candidateFromBody(body) {
    const values = bodyRecord(body);
    if (!values) return null;
    const channelId = String(values.channel || '');
    const token = String(values.token || '');
    const blocks = jsonArray(values.blocks);
    const text = typeof values.text === 'string' ? values.text : '';
    const normalized = normalizedBroadcastPayload(blocks, text);
    const kinds = normalized.kinds;
    if (!kinds.size || !/^[CG][A-Z0-9]+$/.test(channelId) || !token) return null;
    const threadTs =
      typeof values.thread_ts === 'string' && /^\d{1,16}\.\d{1,16}$/.test(values.thread_ts)
        ? values.thread_ts
        : undefined;
    const uploads = [...fileReferences(blocks)].map(([sourceId, title]) => ({
      sourceId,
      name: title || 'attachment',
    }));
    return {
      token,
      requiresHandoff: normalized.requiresHandoff,
      dedupe: String(values.client_msg_id || `${channelId}:${threadTs || ''}:${text}:${JSON.stringify(blocks)}`),
      uploads,
      intent: {
        version: 1,
        channelId,
        ...teamIdFrom(values),
        text,
        blocks: normalized.blocks,
        ...(threadTs ? { threadTs } : {}),
        ...(values.unfurl_links === 'false' || values.unfurl_links === false ? { unfurlLinks: false } : {}),
        ...(values.unfurl_media === 'false' || values.unfurl_media === false ? { unfurlMedia: false } : {}),
      },
    };
  }

  function candidateFromFileCompletion(body) {
    const values = bodyRecord(body);
    if (!values) return null;
    const channelId = String(values.channel_id || values.channel || '');
    const token = String(values.token || '');
    const blocks = jsonArray(values.blocks);
    const text = String(values.initial_comment || values.text || '');
    const normalized = normalizedBroadcastPayload(blocks, text);
    const kinds = normalized.kinds;
    const files = jsonArray(values.files)
      .map((file) => ({ id: String(file?.id || ''), title: String(file?.title || '') }))
      .filter((file) => /^F[A-Z0-9]+$/.test(file.id));
    if (!kinds.size || !files.length || !/^[CG][A-Z0-9]+$/.test(channelId) || !token) return null;
    const threadTs = /^\d{1,16}\.\d{1,16}$/.test(String(values.thread_ts || '')) ? String(values.thread_ts) : undefined;
    const uploads = files.map((file) => ({ sourceId: file.id, name: file.title || 'attachment' }));
    return {
      token,
      requiresHandoff: normalized.requiresHandoff,
      dedupe: `${channelId}:${threadTs || ''}:${files.map((file) => file.id).join(',')}:${text}:${JSON.stringify(blocks)}`,
      uploads,
      intent: {
        version: 1,
        channelId,
        ...teamIdFrom(values),
        text,
        blocks: normalized.blocks,
        ...(threadTs ? { threadTs } : {}),
      },
    };
  }

  function responseData(response) {
    try {
      return response && typeof response === 'object' ? response : JSON.parse(String(response || '{}'));
    } catch (error) {
      return {};
    }
  }

  function composerMentionMatches(text) {
    const matches = [];
    for (const match of String(text || '').matchAll(/(^|[^\p{L}\p{N}_])@(channel|here)\b/giu)) {
      const start = match.index + match[1].length;
      matches.push({ start, end: start + match[0].length - match[1].length, kind: match[2].toLowerCase() });
    }
    return matches;
  }

  function isChannelConversation(channelId) {
    return /^[CG][A-Z0-9]+$/.test(String(channelId || ''));
  }

  function isManagedChannel(channelId) {
    const seenAt = managedChannels.get(String(channelId || '')) || 0;
    if (Date.now() - seenAt < MANAGED_CHANNEL_TTL_MS) return true;
    if (seenAt) managedChannels.delete(String(channelId || ''));
    return false;
  }

  function teamIdFrom(values) {
    return typeof values.client_context_team_id === 'string' && /^[TE][A-Z0-9]+$/.test(values.client_context_team_id)
      ? { teamId: values.client_context_team_id }
      : {};
  }

  function deltaBroadcastKinds(delta) {
    const kinds = new Set();
    for (const op of Array.isArray(delta?.ops) ? delta.ops : []) {
      const id = op?.attributes?.slackmention?.id;
      if (id === 'BKchannel') kinds.add('channel');
      if (id === 'BKhere') kinds.add('here');
    }
    return kinds;
  }

  function deltaCandidateKinds(delta) {
    const kinds = deltaBroadcastKinds(delta);
    let searchable = '';
    for (const op of Array.isArray(delta?.ops) ? delta.ops : []) {
      if (typeof op?.insert !== 'string') continue;
      const mention = op?.attributes?.slackmention;
      if (mention) {
        searchable += mention.id === 'BKchannel' || mention.id === 'BKhere' ? op.insert : ' ';
        continue;
      }
      if (op.attributes?.code === true || op.attributes?.['code-block']) searchable += ' ';
      else searchable += op.insert;
    }
    textBroadcastKinds(searchable, kinds);
    return kinds;
  }

  function plainTextFromDelta(delta) {
    return (Array.isArray(delta?.ops) ? delta.ops : [])
      .map((op) => {
        if (typeof op?.insert === 'string') return op.insert;
        const mention = op?.attributes?.slackmention;
        return typeof mention?.label === 'string' ? mention.label : '';
      })
      .join('')
      .replace(/\n$/, '');
  }

  function reactFiber(node) {
    for (let current = node; current; current = current.parentElement) {
      const key = Object.keys(current).find((name) => name.startsWith('__reactFiber$'));
      if (key) return current[key];
    }
    return null;
  }

  function componentName(fiber) {
    return (
      fiber?.stateNode?.constructor?.displayName ||
      fiber?.stateNode?.constructor?.name ||
      fiber?.type?.displayName ||
      fiber?.type?.name
    );
  }

  function componentFromFiber(fiber, name) {
    for (let current = fiber; current; current = current.return) {
      if (componentName(current) === name && current.stateNode) return current.stateNode;
    }
    return null;
  }

  function storeFromFiber(fiber) {
    for (let current = fiber; current; current = current.return) {
      for (const props of [current.memoizedProps, current.pendingProps, current.stateNode?.props]) {
        if (props?.store && typeof props.store.getState === 'function' && typeof props.store.dispatch === 'function') {
          return props.store;
        }
      }
    }
    return null;
  }

  function currentSlackStore() {
    for (const composer of document.querySelectorAll?.(COMPOSER_SELECTOR) || []) {
      const store = storeFromFiber(reactFiber(composer));
      if (store) return store;
    }
    return null;
  }

  function getSlackRequire() {
    if (slackRequire) return slackRequire;
    const chunks = window.rspackChunkwebapp;
    if (!Array.isArray(chunks)) throw new Error("Slack's message formatter is not available yet.");
    const id = `slick_bchannel_${Date.now()}_${Math.random().toString(36).slice(2)}`;
    chunks.push([
      [id],
      {},
      (runtimeRequire) => {
        slackRequire = runtimeRequire;
      },
    ]);
    if (!slackRequire) throw new Error("Slack's message formatter could not be loaded.");
    return slackRequire;
  }

  function getSlackSerializer() {
    if (slackSerializer) return slackSerializer;
    const runtimeRequire = getSlackRequire();
    let known;
    try {
      known = runtimeRequire('DiPi');
    } catch (error) {}
    if (typeof known?.A === 'function') slackSerializer = known.A;
    if (!slackSerializer) {
      for (const [id, factory] of Object.entries(runtimeRequire.m || {})) {
        if (!String(factory).includes('convertDeltaToBlocks')) continue;
        const exports = runtimeRequire(id);
        const candidate = Object.values(exports || {}).find((value) => typeof value === 'function');
        if (candidate) {
          slackSerializer = candidate;
          break;
        }
      }
    }
    if (!slackSerializer) throw new Error("This Slack version's message formatter is not supported yet.");
    return slackSerializer;
  }

  function blocksFromDelta(delta, store) {
    const result = getSlackSerializer()({ delta, state: store.getState() });
    if (!Array.isArray(result?.blocks)) throw new Error('Slack could not format this message for bChannel.');
    return result.blocks;
  }

  function composerAttachmentRoot(composer) {
    return (
      composer?.closest?.(
        '.p-message_pane_input, .p-message_input, .p-threads_footer, [data-qa="message_input_container"], [data-qa="message_input"]',
      ) ||
      composer?.parentElement?.parentElement ||
      document
    );
  }

  function draftImageFromDom(fileId, root = document) {
    if (!/^F[A-Z0-9]+$/.test(String(fileId || ''))) return null;
    for (const button of root.querySelectorAll?.('[aria-describedby^="draft-image-file-name-F"]') || []) {
      const labelId = String(button.getAttribute?.('aria-describedby') || '');
      if (labelId !== `draft-image-file-name-${fileId}`) continue;
      const image = button.querySelector?.('img[data-qa="file_thumbnail_img"]');
      const name = String(document.getElementById?.(labelId)?.textContent || image?.alt || '').trim();
      let thumbnail;
      try {
        thumbnail = new URL(String(image?.src || ''));
      } catch (error) {}
      const match = thumbnail?.pathname.match(/^\/files-tmb\/([TE][A-Z0-9]+)-(F[A-Z0-9]+)-[^/]+\//);
      if (
        !name ||
        name.length > 255 ||
        thumbnail?.protocol !== 'https:' ||
        !(thumbnail.hostname === 'slack.com' || thumbnail.hostname.endsWith('.slack.com')) ||
        match?.[2] !== fileId
      )
        return null;
      return {
        sourceId: fileId,
        name,
        mimeType: inferredMimeType(name),
        privateUrl: `https://files.slack.com/files-pri/${match[1]}-${match[2]}/${encodeURIComponent(name)}`,
      };
    }
    return null;
  }

  function draftImageIdsFromDom(root = document) {
    const ids = [];
    for (const button of root.querySelectorAll?.('[aria-describedby^="draft-image-file-name-F"]') || []) {
      const match = String(button.getAttribute?.('aria-describedby') || '').match(
        /^draft-image-file-name-(F[A-Z0-9]+)$/,
      );
      if (match && draftImageFromDom(match[1], root)) ids.push(match[1]);
    }
    return [...new Set(ids)];
  }

  async function slackPrivateFileMetadata(fileId, root) {
    const draftFile = draftImageFromDom(fileId, root);
    if (!draftFile || !IMAGE_TYPES.has(draftFile.mimeType)) return null;
    let response;
    try {
      response = await nativeFetch.call(window, draftFile.privateUrl, {
        method: 'HEAD',
        credentials: 'include',
        redirect: 'follow',
        signal: AbortSignal.timeout(15000),
      });
    } catch (error) {
      return null;
    }
    const mimeType = String(response.headers.get('content-type') || draftFile.mimeType)
      .split(';', 1)[0]
      .toLowerCase();
    const size = Number(response.headers.get('content-length') || 0);
    if (!response.ok || !IMAGE_TYPES.has(mimeType) || !Number.isSafeInteger(size) || size <= 0) return null;
    return { ...draftFile, mimeType, size };
  }

  function commandDelta(delta, commandText) {
    const text = `/bchannel ${commandText}`;
    const Delta = delta?.constructor;
    if (typeof Delta !== 'function') return { ops: [{ insert: `${text}\n` }] };
    try {
      const command = new Delta();
      if (typeof command.insert === 'function') return command.insert(text).insert('\n');
      return new Delta([{ insert: `${text}\n` }]);
    } catch (error) {
      return { ops: [{ insert: `${text}\n` }] };
    }
  }

  async function nativeUploads(args, store, composer) {
    const root = composerAttachmentRoot(composer);
    const requestedIds = new Set(Array.isArray(args?.fileIds) ? args.fileIds.map(String) : []);
    const liveDocumentIds = draftImageIdsFromDom(document);
    const visibleImageIds = requestedIds.size
      ? liveDocumentIds.filter((fileId) => requestedIds.has(fileId))
      : draftImageIdsFromDom(root);
    const persistedIds = new Set(
      visibleImageIds.length ? visibleImageIds : Array.isArray(args?.fileIds) ? args.fileIds.map(String) : [],
    );
    const pendingIds = new Set(
      visibleImageIds.length ? [] : Array.isArray(args?.pendingFileIds) ? args.pendingFileIds.map(String) : [],
    );
    if (!persistedIds.size && !pendingIds.size) return [];
    const slackState = store.getState() || {};
    const pending = slackState.pendingFileUploads || {};
    const files = slackState.files || {};
    const uploads = [];
    const seen = new Set();
    const matchedPersisted = new Set();
    const matchedPending = new Set();
    const appendUpload = (sourceId, nameHint, mimeTypeValue, sizeValue, loadBlob) => {
      if (seen.has(sourceId)) return;
      const name = String(nameHint || 'attachment').slice(0, 255);
      const mimeType = String(mimeTypeValue || inferredMimeType(name)).toLowerCase();
      const size = Number(sizeValue || 0);
      if (!IMAGE_TYPES.has(mimeType)) {
        throw new Error('bChannel can only send image attachments. Remove the other files and try again.');
      }
      if (!Number.isSafeInteger(size) || size <= 0 || typeof loadBlob !== 'function') return;
      const slot = window.crypto.randomUUID();
      seen.add(sourceId);
      uploads.push({
        sourceId,
        name,
        slot,
        loadBlob,
        descriptor: { sourceId, name, slot, mimeType, size },
      });
    };
    const downloadImage = async (url, name, expectedMime, expectedSize) => {
      const response = await nativeFetch.call(window, url, {
        method: 'GET',
        credentials: 'include',
        redirect: 'follow',
        signal: AbortSignal.timeout(120000),
      });
      if (!response.ok) throw new Error(`Slack couldn't retrieve ${name}.`);
      const blob = await response.blob();
      const mimeType = imageMimeType(blob, name);
      if (mimeType !== String(expectedMime || '').toLowerCase() || blob.size !== Number(expectedSize || 0)) {
        throw new Error('Slack returned attachment bytes that did not match the selected image.');
      }
      return blob;
    };
    for (const [pendingId, entry] of Object.entries(pending)) {
      const persistedId = String(entry?.persistedFileId || '');
      if (!pendingIds.has(pendingId) && !persistedIds.has(persistedId)) continue;
      const sourceId = /^F[A-Z0-9]+$/.test(persistedId)
        ? persistedId
        : `FSLICK${window.crypto.randomUUID().replace(/-/g, '').toUpperCase()}`;
      const file = entry?.file;
      if (file instanceof Blob) {
        appendUpload(sourceId, file.name || entry?.name, file.type, file.size, async () => file);
      }
      if (seen.has(sourceId)) {
        if (persistedIds.has(persistedId)) matchedPersisted.add(persistedId);
        if (pendingIds.has(pendingId)) matchedPending.add(pendingId);
      }
    }
    for (const persistedId of persistedIds) {
      if (matchedPersisted.has(persistedId)) continue;
      const file = files[persistedId];
      const privateUrl = String(file?.url_private_download || file?.url_private || '');
      let parsedUrl;
      try {
        parsedUrl = new URL(privateUrl);
      } catch (error) {}
      const trustedUrl =
        parsedUrl?.protocol === 'https:' &&
        (parsedUrl.hostname === 'slack.com' || parsedUrl.hostname.endsWith('.slack.com'));
      if (file && file.mode !== 'tombstone' && file.is_deleted !== true && trustedUrl) {
        appendUpload(persistedId, file.name || file.title, file.mimetype, file.size, () =>
          downloadImage(privateUrl, file.name || file.title || 'this image', file.mimetype, file.size),
        );
      }
      if (seen.has(persistedId)) matchedPersisted.add(persistedId);
    }
    for (const persistedId of persistedIds) {
      if (matchedPersisted.has(persistedId)) continue;
      const file = await slackPrivateFileMetadata(persistedId, document);
      if (!file) continue;
      appendUpload(file.sourceId, file.name, file.mimeType, file.size, () =>
        downloadImage(file.privateUrl, file.name, file.mimeType, file.size),
      );
      if (seen.has(persistedId)) matchedPersisted.add(persistedId);
    }
    if (
      persistedIds.size > 0 &&
      matchedPersisted.size === persistedIds.size &&
      pendingIds.size <= persistedIds.size &&
      uploads.length === persistedIds.size
    ) {
      for (const pendingId of pendingIds) matchedPending.add(pendingId);
    }
    if (matchedPersisted.size !== persistedIds.size || matchedPending.size !== pendingIds.size) {
      throw new Error(
        matchedPersisted.size || matchedPending.size
          ? 'This draft contains an attachment Slack no longer has. Remove any "Hidden file" attachment, then try again.'
          : 'Slack no longer has the bytes for one or more attachments. Remove and attach those files again.',
      );
    }
    return uploads;
  }

  function blocksWithUploads(blocks, uploads) {
    if (!uploads.length) return blocks;
    let section;
    for (const block of blocks) {
      if (block?.type !== 'rich_text' || !Array.isArray(block.elements)) continue;
      section = block.elements.find(
        (element) => element?.type === 'rich_text_section' && Array.isArray(element.elements),
      );
      if (section) break;
    }
    if (!section) {
      section = { type: 'rich_text_section', elements: [] };
      blocks.push({ type: 'rich_text', elements: [section] });
    }
    for (const upload of uploads) {
      section.elements.push({ type: 'file', file_id: upload.sourceId, text: upload.name });
    }
    return blocks;
  }

  function notificationTextFromBlocks(blocks, fallback) {
    const neutralize = (value) =>
      String(value || '')
        .replace(/<!(channel|here)(?:\|[^>]*)?>/gi, (_match, kind) => `@\u200b${kind.toLowerCase()}`)
        .replace(/@(channel|here)\b/gi, (_match, kind) => `@\u200b${kind.toLowerCase()}`);
    const render = (value) => {
      if (Array.isArray(value)) return value.map(render).join('');
      if (!value || typeof value !== 'object') return '';
      if (value.type === 'broadcast' && (value.range === 'channel' || value.range === 'here')) {
        return `@${value.range}`;
      }
      if (value.type === 'text' && typeof value.text === 'string') return neutralize(value.text);
      if (value.type === 'user' && typeof value.user_id === 'string') return `<@${value.user_id}>`;
      if (value.type === 'channel' && typeof value.channel_id === 'string') return `<#${value.channel_id}>`;
      if (value.type === 'emoji' && typeof value.name === 'string') return `:${value.name}:`;
      if (value.type === 'link' && typeof value.url === 'string') {
        return typeof value.text === 'string' && value.text !== value.url
          ? `<${value.url}|${value.text}>`
          : `<${value.url}>`;
      }
      if (value.type === 'mrkdwn' && typeof value.text === 'string') return neutralize(value.text);
      if (value.type === 'rich_text_list' && Array.isArray(value.elements)) {
        return value.elements.map(render).join('\n');
      }
      if (Array.isArray(value.elements)) {
        return value.elements.map(render).join(value.type === 'rich_text' ? '\n' : '');
      }
      return '';
    };
    const structural = blocks
      .map(render)
      .filter(Boolean)
      .join('\n')
      .replace(/\n{3,}/g, '\n\n')
      .trim();
    return (structural || neutralize(fallback)).slice(0, 40000);
  }

  async function uploadStagedFiles(token, uploads) {
    for (const upload of uploads) {
      let blob;
      try {
        blob = await upload.loadBlob();
      } catch (error) {
        throw error instanceof Error ? error : new Error(`Slack couldn't retrieve ${upload.name}.`);
      }
      if (!(blob instanceof Blob) || blob.size !== upload.descriptor.size) {
        throw new Error('Slack returned an incomplete attachment.');
      }
      let lastFailure;
      for (let attempt = 1; attempt <= 10; attempt++) {
        let response;
        try {
          response = await nativeFetch.call(
            window,
            `${serviceUrl()}/slick/intents/${encodeURIComponent(token)}/files/${upload.slot}`,
            {
              method: 'PUT',
              credentials: 'omit',
              headers: { 'content-type': upload.descriptor.mimeType },
              body: blob,
              signal: AbortSignal.timeout(120000),
            },
          );
        } catch (error) {
          lastFailure = `Slack didn't confirm whether ${upload.name} finished uploading.`;
          if (attempt < 10) {
            await waitForSlack(slackPropagationDelay(attempt));
            continue;
          }
          throw new Error(lastFailure, { cause: error });
        }
        if (response.ok) {
          lastFailure = null;
          break;
        }
        const failure = await response.json().catch(() => ({}));
        lastFailure = String(failure.message || `bChannel couldn't upload ${upload.name}.`);
        if (attempt < 10 && (response.status === 404 || response.status === 409 || response.status === 429)) {
          await waitForSlack(slackPropagationDelay(attempt));
          continue;
        }
        throw new Error(lastFailure);
      }
      if (lastFailure) throw new Error(lastFailure);
    }
  }

  async function prepareNativeHandoff(original, pane, args, meta) {
    const kinds = deltaCandidateKinds(args?.delta);
    if (!meta.managed || !meta.eligible || !kinds.size) return original.call(pane, args);
    if (!meta.store) throw new Error("Slack's workspace state is not available yet. Try sending again.");

    const dedupe = `${String(args.channelId || '')}:${String(args.threadTs || '')}:${String(args.draftId || '')}:${JSON.stringify(args.delta.ops)}`;
    const existing = handoffsInFlight.get(dedupe);
    if (existing) return existing;

    const run = (async () => {
      let uploads;
      let uploadError;
      for (let attempt = 1; attempt <= 10; attempt++) {
        try {
          uploads = await nativeUploads(args, meta.store, meta.composer);
          uploadError = null;
          break;
        } catch (error) {
          uploadError = error;
          const requestedFileIds = new Set(Array.isArray(args?.fileIds) ? args.fileIds.map(String) : []);
          const visibleRequestedImage = draftImageIdsFromDom(document).some((fileId) => requestedFileIds.has(fileId));
          const uploadMayStillBeResolving =
            visibleRequestedImage || (Array.isArray(args?.pendingFileIds) && args.pendingFileIds.length > 0);
          if (
            attempt >= 10 ||
            !uploadMayStillBeResolving ||
            !/attachment Slack no longer has|Slack no longer has the bytes/i.test(String(error?.message))
          ) {
            throw error;
          }
          await waitForSlack(slackPropagationDelay(attempt));
        }
      }
      if (!uploads) throw uploadError || new Error('Slack could not resolve the selected attachments.');
      const normalizedKinds = new Set();
      const nativeBlocks = blocksFromDelta(args.delta, meta.store);
      const blocks = blocksWithUploads(normalizeRestrictedBroadcasts(nativeBlocks, false, normalizedKinds), uploads);
      if (!broadcastKinds(blocks, new Set()).size) {
        throw new Error('Slack could not recognize the @channel or @here mention in this message.');
      }
      const intent = {
        version: 1,
        channelId: String(args.channelId || ''),
        ...(typeof pane?.props?.teamId === 'string' && /^[TE][A-Z0-9]+$/.test(pane.props.teamId)
          ? { teamId: pane.props.teamId }
          : {}),
        text: notificationTextFromBlocks(blocks, plainTextFromDelta(args.delta)),
        blocks,
        ...(typeof args.threadTs === 'string' && args.threadTs ? { threadTs: args.threadTs } : {}),
        ...(uploads.length ? { files: uploads.map((upload) => upload.descriptor) } : {}),
      };
      let staged = await stageIntent(intent);

      try {
        if (await ensureBChannelReady(staged, meta.store, String(args.channelId || ''))) {
          await discardIntent(staged.token);
          staged = await stageIntent(intent);
        }
        const result = await original.call(pane, {
          ...args,
          delta: commandDelta(args.delta, staged.commandText),
          fileIds: [],
          pendingFileIds: [],
          unfurls: [],
          includeBroadcastKeywordWarning: false,
        });
        await uploadStagedFiles(staged.token, uploads);
        return result;
      } catch (error) {
        await discardIntent(staged.token);
        throw error;
      }
    })();
    handoffsInFlight.set(dedupe, run);
    try {
      return await run;
    } finally {
      if (handoffsInFlight.get(dedupe) === run) handoffsInFlight.delete(dedupe);
    }
  }

  function wrapMessagePane(pane, meta) {
    if (!pane?.props || typeof pane.props.prepareAndSendMessage !== 'function') return;
    const current = pane.props.prepareAndSendMessage;
    if (current.__slickBChannelWrapper) {
      paneState.set(pane, meta);
      return;
    }
    const wrapper = function (args) {
      return prepareNativeHandoff(current, pane, args, paneState.get(pane) || meta).catch((error) => {
        showError(error instanceof Error ? error.message : 'bChannel is unavailable right now.');
        throw error;
      });
    };
    Object.defineProperty(wrapper, '__slickBChannelWrapper', { value: true });
    pane.props.prepareAndSendMessage = wrapper;
    paneState.set(pane, meta);
  }

  function upgradeComposer(composer) {
    const container = composer.closest?.('.ql-container') || composer.parentElement;
    const quill = container?.__quill;
    if (!quill || typeof quill.getModule !== 'function') return;
    const fiber = reactFiber(container || composer);
    if (!fiber) return;
    const autocomplete = componentFromFiber(fiber, 'TextyAutocomplete');
    const pane = componentFromFiber(fiber, 'MessagePaneInput');
    if (!autocomplete?.props) return;

    let meta = composerState.get(composer);
    if (!meta) {
      const originallyEnabled = autocomplete.props.includeAllBroadcastKeywords === true;
      meta = { managed: !originallyEnabled, eligible: false, store: storeFromFiber(fiber), composer };
      composerState.set(composer, meta);
    } else if (!meta.store) {
      meta.store = storeFromFiber(fiber);
    }
    meta.composer = composer;

    const channelId = String(pane?.props?.channelId || '');
    const teamId = String(pane?.props?.teamId || '');
    meta.eligible = isChannelConversation(channelId);

    if (meta.managed && meta.eligible) managedChannels.set(channelId, Date.now());

    if (meta.managed) {
      const autoslug = quill.getModule('autoslug');
      if (autoslug?.options) autoslug.options.includeAllBroadcastKeywords = meta.eligible;
      autocomplete.props.includeAllBroadcastKeywords = meta.eligible;
    }
    const hasBroadcast = meta.eligible && deltaCandidateKinds(quill.getContents?.()).size > 0;
    const preflightKey = hasBroadcast && /^[TE][A-Z0-9]+$/.test(teamId) ? `${teamId}:${channelId}` : '';
    if (preflightKey && meta.preflightKey !== preflightKey) {
      meta.preflightKey = preflightKey;
      void warmChannelReadiness(teamId, channelId, meta.store);
    } else if (!preflightKey) {
      meta.preflightKey = '';
    }
    wrapMessagePane(pane, meta);
  }

  let composerFrame = 0;
  function scheduleComposerUpgrade() {
    if (composerFrame) return;
    const schedule = window.requestAnimationFrame || ((callback) => (window.setTimeout || setTimeout)(callback, 0));
    composerFrame = schedule(() => {
      composerFrame = 0;
      for (const composer of document.querySelectorAll?.(COMPOSER_SELECTOR) || []) upgradeComposer(composer);
    });
  }

  function installComposerIntegration() {
    for (const event of ['focusin', 'beforeinput', 'input', 'compositionend']) {
      document.addEventListener?.(event, scheduleComposerUpgrade, true);
    }
    const root = document.documentElement || document.body;
    if (typeof window.MutationObserver === 'function' && root) {
      new window.MutationObserver(scheduleComposerUpgrade).observe(root, {
        childList: true,
        subtree: true,
      });
    }
    scheduleComposerUpgrade();
  }

  function removeDialog() {
    document.querySelector('.slick-bchannel-backdrop')?.remove();
  }

  function showError(detail, retry) {
    removeDialog();
    const backdrop = document.createElement('div');
    backdrop.className = 'slick-bchannel-backdrop';
    backdrop.setAttribute('role', 'presentation');

    const dialog = document.createElement('div');
    dialog.className = 'slick-bchannel-dialog';
    dialog.setAttribute('role', 'dialog');
    dialog.setAttribute('aria-modal', 'true');
    dialog.setAttribute('aria-labelledby', 'slick-bchannel-dialog-title');

    const header = document.createElement('div');
    header.className = 'slick-bchannel-dialog__header';
    const title = document.createElement('h2');
    title.id = 'slick-bchannel-dialog-title';
    title.textContent = "This message wasn't sent";
    const close = document.createElement('button');
    close.className = 'slick-bchannel-dialog__close';
    close.type = 'button';
    close.setAttribute('aria-label', 'Close');
    close.textContent = '×';
    header.append(title, close);

    const body = document.createElement('div');
    body.className = 'slick-bchannel-dialog__body';
    const copy = document.createElement('p');
    copy.textContent = retry
      ? `${detail}\n\nYour message is still in Slack. You can try again, or use /bchannel directly.`
      : `${detail}\n\nSlack may still be processing it. Check the conversation before sending it again.`;
    body.append(copy);

    const actions = document.createElement('div');
    actions.className = 'slick-bchannel-dialog__actions';
    const dismiss = document.createElement('button');
    dismiss.className = 'c-button c-button--outline c-button--medium';
    dismiss.type = 'button';
    dismiss.textContent = 'Cancel';
    actions.append(dismiss);
    if (typeof retry === 'function') {
      const again = document.createElement('button');
      again.className = 'c-button c-button--primary c-button--medium';
      again.type = 'button';
      again.textContent = 'Try again';
      again.addEventListener('click', () => {
        removeDialog();
        retry();
      });
      actions.append(again);
    }
    dialog.append(header, body, actions);
    backdrop.append(dialog);
    const closeDialog = () => removeDialog();
    close.addEventListener('click', closeDialog);
    dismiss.addEventListener('click', closeDialog);
    backdrop.addEventListener('mousedown', (event) => {
      if (event.target === backdrop) closeDialog();
    });
    const escape = (event) => {
      if (event.key !== 'Escape') return;
      document.removeEventListener('keydown', escape, true);
      closeDialog();
    };
    document.addEventListener('keydown', escape, true);
    document.body.append(backdrop);
    close.focus();
  }

  async function stageIntent(intent) {
    const stagedResponse = await nativeFetch.call(window, `${serviceUrl()}/slick/intents`, {
      method: 'POST',
      credentials: 'omit',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(intent),
      signal: AbortSignal.timeout(15000),
    });
    const staged = await stagedResponse.json().catch(() => ({}));
    if (
      !stagedResponse.ok ||
      typeof staged.commandText !== 'string' ||
      typeof staged.token !== 'string' ||
      !/^[A-Za-z0-9_-]{43}$/.test(staged.token)
    ) {
      throw new Error(String(staged.message || "bChannel couldn't prepare this message."));
    }
    return staged;
  }

  function setupBotId(staged) {
    const id = String(staged?.setup?.botUserId || '');
    return /^U[A-Z0-9]+$/.test(id) ? id : '';
  }

  function prefAllowsBot(pref, botUserId) {
    const value = pref?.pref_value;
    if (!value || typeof value !== 'object') return true;
    const types = Array.isArray(value.type) ? value.type.map(String) : [];
    const users = Array.isArray(value.user) ? value.user.map(String) : [];
    if (users.includes(botUserId)) return true;
    return !types.some((type) => ['admin', 'owner', 'org_admin'].includes(type));
  }

  function postingPrefWithBot(pref, botUserId) {
    const value = pref?.pref_value;
    if (!value || typeof value !== 'object') return '';
    const parts = [];
    for (const type of Array.isArray(value.type) ? value.type : []) parts.push(`type:${String(type)}`);
    for (const user of Array.isArray(value.user) ? value.user : []) parts.push(`user:${String(user)}`);
    for (const subteam of Array.isArray(value.subteam) ? value.subteam : []) parts.push(`subteam:${String(subteam)}`);
    if (!parts.includes(`user:${botUserId}`)) parts.push(`user:${botUserId}`);
    return parts.join(',');
  }

  function waitForSlack(milliseconds) {
    return new Promise((resolve) => (window.setTimeout || setTimeout)(resolve, milliseconds));
  }

  function slackPropagationDelay(attempt) {
    return attempt <= 2 ? 500 : 2_000;
  }

  async function ensureBChannelReady(staged, store, channelId) {
    const botUserId = setupBotId(staged);
    if (!botUserId || !store?.dispatch || !store?.getState || !isChannelConversation(channelId)) return false;
    const cacheKey = `${botUserId}:${channelId}`;
    const cachedAt = readyChannels.get(cacheKey) || 0;
    if (Date.now() - cachedAt < READY_CHANNEL_TTL_MS) return false;
    let runtimeRequire;
    try {
      runtimeRequire = getSlackRequire();
    } catch (error) {
      return false;
    }

    let botIsMember = false;
    let changedSlackState = false;
    try {
      const membership = await runtimeRequire('eh+y').qY(store.dispatch, store.getState, channelId, [botUserId]);
      botIsMember = membership?.[botUserId] === true;
      if (!botIsMember) {
        await store.dispatch(
          runtimeRequire('M9P0').Cw({
            channelId,
            users: botUserId,
            reason: 'slick-bchannel-private-channel-setup',
          }),
        );
        changedSlackState = true;
        for (let attempt = 1; attempt <= 10; attempt++) {
          await waitForSlack(slackPropagationDelay(attempt));
          const refreshed = await runtimeRequire('eh+y').qY(store.dispatch, store.getState, channelId, [botUserId]);
          if (refreshed?.[botUserId] === true) {
            botIsMember = true;
            break;
          }
        }
      }
    } catch (error) {}

    if (!botIsMember) return changedSlackState;

    let postingReady = false;
    try {
      const preferences = runtimeRequire('M9P0');
      const current = await store.dispatch(
        preferences.Kn({
          channelId,
          prefName: 'who_can_post',
          reason: 'slick-bchannel-check-posting-permissions',
        }),
      );
      postingReady = prefAllowsBot(current, botUserId);
      if (!postingReady) {
        const whoCanPost = postingPrefWithBot(current, botUserId);
        if (whoCanPost) {
          await store.dispatch(
            runtimeRequire('Tid6').y({
              channelId,
              newPrefs: JSON.stringify({ who_can_post: whoCanPost }),
              reason: 'slick-bchannel-add-bot-posting-permission',
            }),
          );
          changedSlackState = true;
          for (let attempt = 1; attempt <= 10; attempt++) {
            await waitForSlack(slackPropagationDelay(attempt));
            const refreshed = await store.dispatch(
              preferences.Kn({
                channelId,
                prefName: 'who_can_post',
                reason: 'slick-bchannel-confirm-posting-permissions',
              }),
            );
            if (prefAllowsBot(refreshed, botUserId)) {
              postingReady = true;
              break;
            }
          }
        }
      }
    } catch (error) {}
    if (changedSlackState) await waitForSlack(2_000);
    if (botIsMember && postingReady) readyChannels.set(cacheKey, Date.now());
    return changedSlackState;
  }

  async function discardIntent(token) {
    if (!/^[A-Za-z0-9_-]{43}$/.test(String(token || ''))) return;
    await nativeFetch
      .call(window, `${serviceUrl()}/slick/intents/${encodeURIComponent(token)}`, {
        method: 'DELETE',
        credentials: 'omit',
        signal: AbortSignal.timeout(5000),
      })
      .catch(() => {});
  }

  async function handoff(candidate) {
    const recent = handled.get(candidate.dedupe);
    if (recent && Date.now() - recent < 2 * 60 * 1000) return true;
    handled.set(candidate.dedupe, Date.now());
    for (const [key, at] of handled) if (Date.now() - at >= 2 * 60 * 1000) handled.delete(key);

    let stagedToken = '';
    let commandDispatched = false;
    let ambiguousOutcome = false;
    try {
      const sourceIds = (candidate.uploads || []).map((upload) => upload.sourceId);
      const store = candidate.store || currentSlackStore();
      if (sourceIds.length && !store) {
        throw new Error('Slack could not reopen the selected image. Keep this conversation open and try again.');
      }
      const uploads = sourceIds.length ? await nativeUploads({ fileIds: sourceIds }, store) : [];
      const intent = uploads.length
        ? { ...candidate.intent, files: uploads.map((upload) => upload.descriptor) }
        : candidate.intent;
      let staged = await stageIntent(intent);
      stagedToken = staged.token;
      if (await ensureBChannelReady(staged, currentSlackStore(), intent.channelId)) {
        await discardIntent(staged.token);
        staged = await stageIntent(intent);
        stagedToken = staged.token;
      }

      const commandBody = new URLSearchParams({
        token: candidate.token,
        channel: intent.channelId,
        command: '/bchannel',
        text: staged.commandText,
      });
      let commandResponse;
      try {
        commandResponse = await nativeFetch.call(window, '/api/chat.command', {
          method: 'POST',
          credentials: 'include',
          headers: { 'content-type': 'application/x-www-form-urlencoded; charset=UTF-8' },
          body: commandBody,
          signal: AbortSignal.timeout(15000),
        });
      } catch (error) {
        ambiguousOutcome = true;
        throw new Error("Slack didn't confirm whether bChannel received this message.", { cause: error });
      }
      const commandResult = await commandResponse.json().catch(() => ({}));
      if (!commandResponse.ok || commandResult.ok === false) {
        const code = String(commandResult.error || `http_${commandResponse.status}`);
        const messages = {
          dispatch_failed: "Slack couldn't reach bChannel. Check that the bChannel app is installed and available.",
          unknown_command: "The /bchannel command isn't installed in this workspace. Ask an admin to install bChannel.",
          command_not_found:
            "The /bchannel command isn't installed in this workspace. Ask an admin to install bChannel.",
          invalid_auth: 'Your Slack session is out of date. Sign in to Slack again, then retry.',
          not_authed: 'Slack needs you to sign in again before bChannel can send this message.',
          account_inactive: 'Your Slack account is inactive, so this message could not be sent.',
          team_access_not_granted: "bChannel isn't installed for this workspace. Ask an admin to install it.",
          ratelimited: 'Slack is receiving too many commands right now. Wait a moment and retry.',
        };
        throw new Error(messages[code] || `Slack couldn't hand this message to bChannel (${code}).`);
      }
      commandDispatched = true;

      try {
        await uploadStagedFiles(staged.token, uploads);
      } catch (error) {
        ambiguousOutcome = true;
        throw error;
      }
      return true;
    } catch (error) {
      if (stagedToken && !commandDispatched) {
        await discardIntent(stagedToken);
      }
      handled.delete(candidate.dedupe);
      const message = error instanceof Error ? error.message : 'bChannel is unavailable right now.';
      showError(message, ambiguousOutcome ? undefined : () => handoff(candidate));
      return false;
    }
  }

  async function handoffAsSlackResponse(candidate) {
    const sent = await handoff(candidate);
    return new Response(
      JSON.stringify(
        sent ? { ok: true, channel: candidate.intent.channelId } : { ok: false, error: 'restricted_action' },
      ),
      { status: 200, headers: { 'content-type': 'application/json' } },
    );
  }

  function maybeHandoff(candidate, result) {
    if (!candidate || !result || result.ok !== false || !DENIED_BROADCASTS.has(result.error)) return;
    void handoff(candidate);
  }

  window.fetch = function (input, init) {
    const url = requestUrl(input);
    const body = init?.body;
    const candidate = init
      ? POST_MESSAGE_RE.test(url)
        ? candidateFromBody(body)
        : COMPLETE_UPLOAD_RE.test(url)
          ? candidateFromFileCompletion(body)
          : null
      : null;
    if (candidate && (candidate.requiresHandoff || isManagedChannel(candidate.intent.channelId))) {
      return handoffAsSlackResponse(candidate);
    }
    const request = nativeFetch.apply(this, arguments);
    if (candidate) {
      request
        .then((response) => {
          response
            .clone()
            .json()
            .then((result) => maybeHandoff(candidate, result))
            .catch(() => {});
        })
        .catch(() => {});
    }
    return request;
  };

  const nativeOpen = XMLHttpRequest.prototype.open;
  XMLHttpRequest.prototype.open = function (method, url) {
    this.__slickBChannelUrl = String(url);
    this.__slickBChannelPost =
      String(method || 'GET').toUpperCase() === 'POST' &&
      (POST_MESSAGE_RE.test(this.__slickBChannelUrl) || COMPLETE_UPLOAD_RE.test(this.__slickBChannelUrl));
    return nativeOpen.apply(this, arguments);
  };

  const nativeSend = XMLHttpRequest.prototype.send;
  XMLHttpRequest.prototype.send = function (body) {
    if (this.__slickBChannelPost) {
      const candidate = COMPLETE_UPLOAD_RE.test(this.__slickBChannelUrl || '')
        ? candidateFromFileCompletion(body)
        : candidateFromBody(body);
      if (candidate) {
        this.addEventListener('load', () => maybeHandoff(candidate, responseData(this.responseText || this.response)), {
          once: true,
        });
      }
    }
    return nativeSend.apply(this, arguments);
  };

  installComposerIntegration();
  console.log('[bChannel] active');
})();
