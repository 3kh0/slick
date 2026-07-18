(function () {
  'use strict';
  if (window.__slickMessageLogger) return;

  var ROW_SEL = [
    '.c-message_kit__message',
    '[data-qa="message_container"]',
    '[id^="message-list_"][role="listitem"]',
  ].join(',');
  var CONTENT_SEL = [
    '.c-message_kit__blocks',
    '[data-qa="message-text"]',
    '.p-rich_text_block',
    '.p-rich_text_section',
    '[data-qa="message_content"]',
    '.c-message__body',
    '.c-message__message_blocks',
    '.c-message_kit__text',
  ].join(',');

  const logs = new Map();
  const logsByTs = new Map();
  const known = new Map();
  let selfIds = new Set();
  let jaxN = 0;
  let renderTimer = 0;
  let seenEvents = new Set();

  const keyOf = (channel, ts) => (channel || '*') + ':' + ts;
  const logKey = (type, channel, ts) => type + ':' + keyOf(channel, ts);

  const HIDDEN_STORAGE_KEY = 'slick:ml:hidden';
  function loadHidden() {
    try {
      return new Set(JSON.parse(localStorage.getItem(HIDDEN_STORAGE_KEY)) || []);
    } catch (e) {
      return new Set();
    }
  }
  const hidden = loadHidden();
  function saveHidden() {
    try {
      localStorage.setItem(HIDDEN_STORAGE_KEY, JSON.stringify(Array.from(hidden)));
    } catch (e) {}
  }
  function isHidden(channel, ts) {
    if (hidden.has(keyOf(channel, ts)) || hidden.has(keyOf('', ts))) return true;
    if (channel) return false;
    const suffix = ':' + ts;
    return Array.from(hidden).some((key) => key.endsWith(suffix));
  }
  function hideLog(channel, ts) {
    hidden.add(keyOf(channel, ts));
    while (hidden.size > 1000) hidden.delete(hidden.values().next().value);
    saveHidden();
  }

  function set() {
    return (window.__slickPluginSettings && window.__slickPluginSettings['MessageLogger']) || {};
  }

  function istyle() {
    if (document.getElementById('slick-message-logger-style')) return;
    const style = document.createElement('style');
    style.id = 'slick-message-logger-style';
    style.textContent = [
      '.slick-ml-edited-original{display:block;margin-bottom:2px;color:inherit;opacity:.62;white-space:pre-wrap;word-break:break-word}',
      '.slick-ml-edited-original-line{display:block}',
      '.slick-ml-edited-original s{text-decoration:line-through}',
      '.slick-ml-edited-marker{margin-left:4px;font-size:.85em;opacity:.72}',
      '.slick-ml-row-deleted [data-slick-ml-delete-host][data-slick-ml-deleted-style="red"],.slick-ml-row-deleted [data-slick-ml-delete-host][data-slick-ml-deleted-style="red"] *{color:#e01e5a!important}',
      '.slick-ml-row-deleted [data-slick-ml-delete-host][data-slick-ml-deleted-style="opacity"]{opacity:.5!important}',
      '[data-slick-ml-hide]{cursor:pointer}',
      '[data-slick-ml-hide]:hover,[data-slick-ml-hide]:focus-within{background:var(--p-focus-ring-color,#1264a3)!important;color:#fff!important}',
      '[data-slick-ml-hide]:hover *,[data-slick-ml-hide]:focus-within *{color:#fff!important}',
      '.slick-ml-row-vanished{display:none!important}',
    ].join('\n');
    document.head.appendChild(style);
  }

  function decode(value) {
    let text = String(value == null ? '' : value);
    try {
      const ta = document.createElement('textarea');
      ta.innerHTML = text;
      text = ta.value;
    } catch (e) {}
    return text
      .replace(/<([^>|]+)\|([^>]+)>/g, '$2')
      .replace(/<([^>]+)>/g, '$1')
      .trim();
  }

  function msgt(m) {
    if (!m || typeof m !== 'object') return '';
    if (typeof m.text === 'string') return decode(m.text);
    if (typeof m.message === 'string') return decode(m.message);
    return '';
  }

  function msgu(m) {
    return m && typeof m === 'object' ? m.user || m.user_id || m.sender || m.authorUserId || '' : '';
  }

  function messageTs(m) {
    return m && typeof m === 'object' ? m.ts || m.event_ts || m.message_ts || m.deleted_ts || '' : '';
  }

  function msgc(m, fallback) {
    return (m && typeof m === 'object' && (m.channel || m.channel_id || m.channelId)) || fallback || '';
  }

  function cur() {
    const m = location.pathname.match(/\/client\/[A-Z0-9]+\/([A-Z0-9]+)/);
    return m ? m[1] : '';
  }

  function indexLog(log) {
    const key = logKey(log.type, log.channel, log.ts);
    logs.set(key, log);
    if (!logsByTs.has(log.ts)) logsByTs.set(log.ts, []);
    const list = logsByTs.get(log.ts);
    const i = list.findIndex((x) => x.channel === log.channel && x.type === log.type);
    if (i >= 0) list.splice(i, 1, log);
    else list.push(log);
    return key;
  }

  function logFor(message, type) {
    if (!message || !message.ts) return null;
    const direct = type ? logs.get(logKey(type, message.channel, message.ts)) : null;
    if (direct && (!type || direct.type === type)) return direct;
    const list = logsByTs.get(message.ts);
    if (!list || !list.length) return null;
    return list.find(
      (x) => (!type || x.type === type) && (!x.channel || !message.channel || x.channel === message.channel),
    );
  }

  function exlog(channel, ts, type) {
    const direct = logs.get(logKey(type, channel, ts));
    if (direct) return direct;
    const list = logsByTs.get(ts);
    return list ? list.find((x) => x.type === type && (!x.channel || !channel || x.channel === channel)) : null;
  }

  function curusrs() {
    if (Date.now() < jaxN) return selfIds;
    jaxN = Date.now() + 10000;
    selfIds = new Set();
    try {
      cIDs(JSON.parse(localStorage.getItem('localConfig_v2')), selfIds, 0);
    } catch (e) {}
    try {
      cIDs(window.TS && (window.TS.boot_data || window.TS.model), selfIds, 0);
    } catch (e) {}
    return selfIds;
  }

  function cIDs(value, out, depth) {
    if (!value || depth > 5) return;
    if (Array.isArray(value)) {
      value.slice(0, 40).forEach((x) => cIDs(x, out, depth + 1));
      return;
    }
    if (typeof value !== 'object') return;
    Object.keys(value).forEach((key) => {
      const v = value[key];
      const n = key.replace(/[_-]/g, '').toLowerCase();
      if (
        typeof v === 'string' &&
        /^[UW][A-Z0-9]{6,}$/.test(v) &&
        (n === 'userid' || n === 'selfuserid' || n === 'currentuserid' || n === 'autheduserid')
      ) {
        out.add(v);
      }
      if (typeof v === 'object') cIDs(v, out, depth + 1);
    });
  }

  function shig(user) {
    return set().ignoreSelf !== false && !!user && curusrs().has(user);
  }

  function fiberOf(el) {
    if (!el) return null;
    const key = Object.keys(el).find((n) => n.startsWith('__reactFiber$') || n.startsWith('__reactInternalInstance$'));
    return key ? el[key] : null;
  }

  function messageFromProps(props) {
    if (!props || typeof props !== 'object') return null;
    const message = props.message || props.msg || props.event;
    if (message && typeof message === 'object' && messageTs(message)) {
      return {
        channel: msgc(message, props.channel || props.channelId || props.channel_id),
        ts: messageTs(message),
        user: msgu(message),
        text: msgt(message),
      };
    }
    if (props.ts || props.messageTs || props.message_ts) {
      return {
        channel: props.channel || props.channelId || props.channel_id || '',
        ts: props.ts || props.messageTs || props.message_ts,
        user: props.user || props.userId || props.user_id || '',
        text: typeof props.text === 'string' ? decode(props.text) : '',
      };
    }
    return null;
  }

  function msgFiber(el) {
    let f = fiberOf(el);
    for (let hops = 0; f && hops < 40; f = f.return, hops++) {
      const msg = messageFromProps(f.memoizedProps) || messageFromProps(f.pendingProps);
      if (msg) return msg;
    }
    return null;
  }

  function fr(msg, row) {
    if (!msg.channel) msg.channel = cur();
    if (!msg.text) msg.text = rt(row);
    return msg;
  }

  function msgrow(row) {
    let msg = msgFiber(row);
    if (msg) return fr(msg, row);
    const nodes = row.querySelectorAll('*');
    for (let i = 0; i < nodes.length && i < 80; i++) {
      msg = msgFiber(nodes[i]);
      if (msg) return fr(msg, row);
    }
    const attr = row.getAttribute('data-ts') || row.getAttribute('data-message-ts') || row.id || '';
    const match = String(attr).match(/\d{10}\.\d{6}/);
    return match ? { channel: cur(), ts: match[0], user: '', text: rt(row) } : null;
  }

  function remember(row, message) {
    if (!message || !message.ts) return;
    const entry = {
      channel: message.channel,
      ts: message.ts,
      user: message.user,
      text: message.text,
      row: row,
      parent: row.parentElement,
      nextSibling: row.nextSibling,
    };
    known.set(keyOf(message.channel, message.ts), entry);
    if (message.channel) known.set(keyOf('', message.ts), entry);
    while (known.size > 400) known.delete(known.keys().next().value);
  }

  function contentHost(row) {
    const pick = (root) =>
      root.querySelector('.c-message_kit__blocks') ||
      root.querySelector('[data-qa="message-text"]') ||
      root.querySelector('.p-rich_text_block') ||
      root.querySelector('.p-rich_text_section');
    const direct = pick(row);
    if (direct) return direct;
    const mc = row.querySelector('[data-qa="message_content"]');
    if (mc) return pick(mc) || mc;
    return row.querySelector(CONTENT_SEL) || row;
  }

  function rt(row) {
    const clone = contentHost(row).cloneNode(true);
    clone.querySelectorAll('.slick-ml-edited-original,.slick-ml-deleted').forEach((el) => el.remove());
    return decode((clone.textContent || '').replace(/\s*\(edited\)\s*$/, ''));
  }

  const kmsg = (channel, ts) => known.get(keyOf(channel, ts)) || known.get(keyOf('', ts)) || null;

  function smsg(channel, ts) {
    if (!ts) return null;
    const snapshot = kmsg(channel, ts);
    if (snapshot) return snapshot;
    const rows = document.querySelectorAll(ROW_SEL);
    for (let i = 0; i < rows.length; i++) {
      const message = msgrow(rows[i]);
      if (!message || message.ts !== ts) continue;
      if (channel && message.channel && message.channel !== channel) continue;
      remember(rows[i], message);
      return message;
    }
    return null;
  }

  function tstr(text) {
    const s = document.createElement('s');
    s.textContent = text;
    return s;
  }

  const ee = (log) => (log.edits && log.edits.length ? log.edits : [{ oldText: log.oldText, newText: log.newText }]);

  function apsok(parent, text) {
    const line = document.createElement('span');
    line.className = 'slick-ml-edited-original-line';
    line.appendChild(tstr(text || '(empty message)'));
    const marker = document.createElement('span');
    marker.className = 'slick-ml-edited-marker';
    marker.textContent = '(edited)';
    line.appendChild(marker);
    parent.appendChild(line);
  }

  function aedit(row, log) {
    const host = contentHost(row);
    let existing = row.querySelector('.slick-ml-edited-original');
    if (!existing) {
      existing = document.createElement('span');
      existing.className = 'slick-ml-edited-original';
    }
    const entries = ee(log);
    const signature = entries.map((e) => e.oldText || '').join('\n---slick-ml-edit---\n');
    if (existing.parentElement === host && existing.dataset.slickMlText === signature) return;
    if (existing.parentElement !== host) host.insertBefore(existing, host.firstChild);
    existing.dataset.slickMlText = signature;
    existing.textContent = '';
    entries.forEach((e) => apsok(existing, e.oldText));
  }

  const deletedKey = (log) => keyOf(log.channel, log.ts);

  function adel(row, log) {
    if (!row || !log) return false;
    const host = contentHost(row);
    if (!host) return false;
    const key = deletedKey(log);
    row.classList.add('slick-ml-row-deleted');
    row.dataset.slickMlDeletedKey = key;
    host.dataset.slickMlDeleteHost = 'true';
    host.dataset.slickMlDeletedKey = key;
    host.dataset.slickMlDeletedStyle = set().deletedStyle === 'opacity' ? 'opacity' : 'red';
    return true;
  }

  function removeEditOverlay(row) {
    const el = row.querySelector('.slick-ml-edited-original');
    if (el) el.remove();
  }

  function removeDeleteOverlay(row) {
    row.classList.remove('slick-ml-row-deleted');
    delete row.dataset.slickMlDeletedKey;
    const host = row.querySelector('[data-slick-ml-delete-host]');
    if (host) {
      delete host.dataset.slickMlDeleteHost;
      delete host.dataset.slickMlDeletedKey;
      delete host.dataset.slickMlDeletedStyle;
    }
  }

  function ispn(node) {
    if (!node || node.nodeType !== Node.ELEMENT_NODE) return false;
    return !!(
      (node.id && node.id.indexOf('slick-ml-') === 0) ||
      (node.classList &&
        (node.classList.contains('slick-ml-edited-original') || node.classList.contains('slick-ml-deleted'))) ||
      (node.closest && node.closest('.slick-ml-edited-original,.slick-ml-deleted'))
    );
  }

  function arow(row) {
    if (!row || ispn(row)) return;
    const message = msgrow(row);
    if (!message || !message.ts) return;
    remember(row, message);
    if (isHidden(message.channel, message.ts)) {
      removeEditOverlay(row);
      removeDeleteOverlay(row);
      row.classList.toggle('slick-ml-row-vanished', !!logFor(message, 'deleted'));
      return;
    }
    row.classList.remove('slick-ml-row-vanished');
    const edited = logFor(message, 'edited');
    if (edited) aedit(row, edited);
    const deleted = logFor(message, 'deleted');
    if (deleted) adel(row, deleted);
  }

  function scan(root) {
    istyle();
    if (root && root.nodeType !== Node.ELEMENT_NODE && root.nodeType !== Node.DOCUMENT_NODE) return;
    const scope = root || document;
    if (ispn(scope)) return;
    if (scope.matches && scope.matches(ROW_SEL)) arow(scope);
    if (scope.querySelectorAll) scope.querySelectorAll(ROW_SEL).forEach(arow);
  }

  function sscan() {
    if (renderTimer) return;
    renderTimer = setTimeout(() => {
      renderTimer = 0;
      scan(document.body || document);
    }, 120);
  }

  function cleanSeen() {
    if (seenEvents.size >= 500) seenEvents = new Set(Array.from(seenEvents).slice(-250));
  }

  function redit(event) {
    const previous = event.previous_message || event.previous || {};
    const message = event.message || {};
    const ts = messageTs(message) || messageTs(previous);
    if (!ts) return;
    const channel = msgc(message, msgc(previous, event.channel));
    const user = msgu(message) || msgu(previous);
    if (shig(user)) return;
    const oldText = msgt(previous);
    const newText = msgt(message);
    if (!oldText || oldText === newText) return;
    const id = 'edited:' + keyOf(channel, ts) + ':' + oldText + ':' + newText;
    if (seenEvents.has(id)) return;
    seenEvents.add(id);
    cleanSeen();
    let log = exlog(channel, ts, 'edited');
    if (!log) {
      log = { type: 'edited', channel: channel, ts: ts, user: user, edits: [] };
      indexLog(log);
    }
    log.user = log.user || user;
    log.oldText = oldText;
    log.newText = newText;
    log.edits.push({ oldText: oldText, newText: newText });
    sscan();
  }

  function visit(value, depth) {
    if (!value || depth > 8) return;
    if (Array.isArray(value)) {
      value.forEach((x) => visit(x, depth + 1));
      return;
    }
    if (typeof value !== 'object') return;
    if (value.subtype === 'message_changed') redit(value);
    Object.keys(value).forEach((key) => {
      if (value[key] && typeof value[key] === 'object') visit(value[key], depth + 1);
    });
  }

  function redel(event) {
    if (!event || event.subtype !== 'message_deleted') return event;
    const previous = event.previous_message || event.previous || {};
    const ts = event.deleted_ts || messageTs(previous) || messageTs(event);
    if (!ts) return event;
    const channel = msgc(previous, event.channel);
    const snapshot = smsg(channel, ts);
    const user = msgu(previous) || (snapshot && snapshot.user) || event.previous_user || event.user || '';
    if (shig(user)) return event;
    const oldText = msgt(previous) || (snapshot && snapshot.text) || '';
    const id = 'deleted:' + keyOf(channel, ts) + ':' + oldText;
    if (!seenEvents.has(id)) {
      seenEvents.add(id);
      cleanSeen();
      indexLog({ type: 'deleted', channel: channel, ts: ts, user: user, oldText: oldText });
      sscan();
    }
    const message = Object.assign({}, previous);
    message.type = message.type || 'message';
    message.channel = msgc(message, channel);
    message.ts = messageTs(message) || ts;
    message.user = msgu(message) || user;
    message.text = oldText;
    delete message.subtype;
    return {
      type: event.type || 'message',
      subtype: 'message_changed',
      channel: channel,
      message: message,
      previous_message: previous,
      event_ts: event.event_ts || event.deleted_ts || message.ts,
      ts: event.ts || message.ts,
    };
  }

  function redels(value, depth) {
    if (!value || depth > 8) return { value: value, changed: false };
    if (Array.isArray(value)) {
      let changed = false;
      const out = value.map((item) => {
        const r = redels(item, depth + 1);
        if (r.changed) changed = true;
        return r.value;
      });
      return { value: changed ? out : value, changed: changed };
    }
    if (typeof value !== 'object') return { value: value, changed: false };
    if (value.subtype === 'message_deleted') {
      const rewritten = redel(value);
      return { value: rewritten, changed: rewritten !== value };
    }
    let changed = false;
    let out = value;
    Object.keys(value).forEach((key) => {
      const child = value[key];
      if (!child || typeof child !== 'object') return;
      const r = redels(child, depth + 1);
      if (!r.changed) return;
      if (!changed) out = Object.assign({}, value);
      changed = true;
      out[key] = r.value;
    });
    return { value: out, changed: changed };
  }

  function transformSocketData(data) {
    const parsed = pSocd(data);
    if (!parsed) return data;
    const r = redels(parsed, 0);
    return r.changed ? JSON.stringify(r.value) : data;
  }

  function eventWithData(event, data) {
    if (!event || data === event.data) return event;
    try {
      return new MessageEvent(event.type, {
        data: data,
        origin: event.origin,
        lastEventId: event.lastEventId,
        source: event.source || null,
        ports: event.ports || [],
      });
    } catch (e) {}
    try {
      const replacement = Object.create(event);
      Object.defineProperty(replacement, 'data', { value: data });
      return replacement;
    } catch (e) {
      return event;
    }
  }

  function pSocd(data) {
    if (typeof data !== 'string') return null;
    if (data.indexOf('message_') === -1 && data.indexOf('previous_message') === -1) return null;
    try {
      return JSON.parse(data);
    } catch (e) {
      return null;
    }
  }

  function onSocket(event) {
    const parsed = pSocd(event && event.data);
    if (parsed) visit(parsed, 0);
  }

  function psocket() {
    const Native = window.WebSocket;
    if (!Native || Native.__slickMessageLoggerPatched) return;
    const armed = new WeakSet();
    const nativeAdd = Native.prototype.addEventListener;
    const transform = (event) => eventWithData(event, transformSocketData(event && event.data));

    function arm(socket) {
      if (!socket || armed.has(socket)) return;
      armed.add(socket);
      try {
        nativeAdd.call(socket, 'message', onSocket, true);
      } catch (e) {}
    }

    function SWS(url, protocols) {
      const socket = protocols === undefined ? new Native(url) : new Native(url, protocols);
      arm(socket);
      return socket;
    }

    try {
      Object.setPrototypeOf(SWS, Native);
    } catch (e) {}
    SWS.prototype = Native.prototype;
    ['CONNECTING', 'OPEN', 'CLOSING', 'CLOSED'].forEach((key) => {
      try {
        Object.defineProperty(SWS, key, { value: Native[key] });
      } catch (e) {}
    });

    Native.prototype.addEventListener = function (type, listener, options) {
      if (type === 'message') arm(this);
      if (type !== 'message' || !listener) return nativeAdd.apply(this, arguments);
      const wrapped =
        typeof listener === 'function'
          ? function (event) {
              return listener.call(this, transform(event));
            }
          : function (event) {
              if (listener.handleEvent) return listener.handleEvent(transform(event));
            };
      return nativeAdd.call(this, type, wrapped, options);
    };

    try {
      const desc = Object.getOwnPropertyDescriptor(Native.prototype, 'onmessage');
      if (desc && desc.configurable) {
        Object.defineProperty(Native.prototype, 'onmessage', {
          configurable: true,
          enumerable: desc.enumerable,
          get: function () {
            return desc.get ? desc.get.call(this) : undefined;
          },
          set: function (value) {
            arm(this);
            if (!desc.set || typeof value !== 'function') {
              if (desc.set) desc.set.call(this, value);
              return;
            }
            desc.set.call(this, function (event) {
              return value.call(this, transform(event));
            });
          },
        });
      }
    } catch (e) {}

    SWS.__slickMessageLoggerPatched = true;
    window.WebSocket = SWS;
  }

  function ap(out, value) {
    if (!value) return;
    if (typeof value === 'string') {
      const trimmed = value.trim();
      if (trimmed[0] === '{' || trimmed[0] === '[') {
        try {
          ap(out, JSON.parse(trimmed));
          return;
        } catch (e) {}
      }
      try {
        new URLSearchParams(value).forEach((v, k) => out.set(k, v));
        return;
      } catch (e) {}
      try {
        ap(out, JSON.parse(value));
      } catch (e) {}
      return;
    }
    if (typeof URLSearchParams !== 'undefined' && value instanceof URLSearchParams) {
      value.forEach((v, k) => out.set(k, v));
      return;
    }
    if (typeof FormData !== 'undefined' && value instanceof FormData) {
      value.forEach((v, k) => {
        if (typeof v === 'string') out.set(k, v);
      });
      return;
    }
    if (typeof value !== 'object') return;
    Object.keys(value).forEach((key) => {
      const v = value[key];
      if (v != null && typeof v !== 'object') out.set(key, String(v));
    });
  }

  function rp(url, body) {
    const o = new URLSearchParams();
    try {
      new URL(String(url), location.href).searchParams.forEach((v, k) => o.set(k, v));
    } catch (e) {}
    ap(o, body);
    return o;
  }

  function apiMethod(url, params) {
    const text = String(url || '');
    const method = params.get('method') || params.get('_method') || '';
    if (text.indexOf('chat.delete') !== -1 || method === 'chat.delete') return 'chat.delete';
    if (text.indexOf('chat.update') !== -1 || method === 'chat.update') return 'chat.update';
    return '';
  }

  function routdel(channel, ts) {
    if (set().ignoreSelf !== false || !ts) return;
    const snapshot = smsg(channel, ts);
    const oldText = (snapshot && snapshot.text) || '';
    const user = (snapshot && snapshot.user) || '';
    const id = 'deleted-api:' + keyOf(channel, ts) + ':' + oldText;
    if (seenEvents.has(id)) return;
    seenEvents.add(id);
    cleanSeen();
    indexLog({ type: 'deleted', channel: channel || cur(), ts: ts, user: user, oldText: oldText });
    sscan();
  }

  function routup(channel, ts, newText) {
    if (set().ignoreSelf !== false || !ts) return;
    const snapshot = smsg(channel, ts);
    const oldText = (snapshot && snapshot.text) || '';
    newText = decode(newText || '');
    if (!oldText || oldText === newText) return;
    const user = (snapshot && snapshot.user) || '';
    const id = 'edited-api:' + keyOf(channel, ts) + ':' + oldText + ':' + newText;
    if (seenEvents.has(id)) return;
    seenEvents.add(id);
    cleanSeen();
    indexLog({
      type: 'edited',
      channel: channel || cur(),
      ts: ts,
      user: user,
      oldText: oldText,
      newText: newText,
    });
    sscan();
  }

  function capi(url, body) {
    const p = rp(url, body);
    const m = apiMethod(url, p);
    if (!m) return;
    const channel = p.get('channel') || p.get('channel_id') || cur();
    const ts = p.get('ts') || p.get('message_ts') || '';
    if (m === 'chat.delete') routdel(channel, ts);
    else if (m === 'chat.update') routup(channel, ts, p.get('text') || '');
  }

  function papi() {
    if (window.__slickMessageLoggerApiPatched) return;
    window.__slickMessageLoggerApiPatched = true;

    const nativeFetch = window.fetch;
    if (nativeFetch) {
      window.fetch = function (input, init) {
        try {
          capi((input && input.url) || input, init && init.body);
        } catch (e) {}
        return nativeFetch.apply(this, arguments);
      };
    }

    const proto = typeof XMLHttpRequest !== 'undefined' && XMLHttpRequest.prototype;
    const o = proto && proto.open;
    const s = proto && proto.send;
    if (o && s) {
      proto.open = function (_method, url) {
        this.__slickMlUrl = url;
        return o.apply(this, arguments);
      };
      proto.send = function (body) {
        try {
          capi(this.__slickMlUrl, body);
        } catch (e) {}
        return s.apply(this, arguments);
      };
    }
  }

  function menuItemRow(item, menu) {
    const wrapper = item.closest('li,.c-menu_item__li');
    return wrapper && menu.contains(wrapper) ? wrapper : item;
  }

  function stripHighlight(root) {
    if (!root) return;
    for (const el of [root, ...root.querySelectorAll('*')]) {
      if (el.classList) {
        const toRemove = [];
        for (const cls of el.classList) {
          if (/highlight|selected/i.test(cls)) toRemove.push(cls);
        }
        for (const cls of toRemove) el.classList.remove(cls);
      }
      if (el.getAttribute && el.getAttribute('aria-selected') === 'true') el.setAttribute('aria-selected', 'false');
      if (el.removeAttribute) el.removeAttribute('aria-current');
    }
  }

  function hideItemLabel(edited, deleted) {
    if (deleted) return 'Hide deletion notice';
    return 'Hide edit history';
  }

  function injectHideItem(menu, reference, message, edited, deleted) {
    const key = keyOf(message.channel, message.ts);
    const existing = menu.querySelector('[data-slick-ml-hide]');
    if (existing) {
      if (existing.dataset.slickMlHideKey === key) return;
      menuItemRow(existing, menu).remove();
    }

    const wrapper = menuItemRow(reference, menu);
    const clone = wrapper.cloneNode(true);
    const item = clone.matches('button,[role="menuitem"]') ? clone : clone.querySelector('button,[role="menuitem"]');
    if (!item) return;

    clone.dataset.slickMlHide = 'true';
    clone.dataset.slickMlHideKey = key;
    clone.querySelectorAll('[id]').forEach((el) => el.removeAttribute('id'));
    ['data-qa', 'aria-controls', 'aria-describedby', 'aria-expanded', 'aria-haspopup'].forEach((attr) =>
      item.removeAttribute(attr),
    );
    stripHighlight(clone);

    const label = clone.querySelector('.c-menu_item__label');
    if (label) label.textContent = hideItemLabel(edited, deleted);
    else item.textContent = hideItemLabel(edited, deleted);

    item.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      hideLog(message.channel, message.ts);
      const snapshot = kmsg(message.channel, message.ts);
      if (snapshot && snapshot.row) {
        removeEditOverlay(snapshot.row);
        removeDeleteOverlay(snapshot.row);
        snapshot.row.classList.toggle('slick-ml-row-vanished', !!deleted);
      }
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    });

    wrapper.after(clone);
  }

  function xmenu(root) {
    const scope = root || document;
    if (scope.nodeType !== Node.ELEMENT_NODE && scope.nodeType !== Node.DOCUMENT_NODE) return;
    const menus = [];
    if (scope.matches && scope.matches('[role="menu"],.c-menu')) menus.push(scope);
    if (scope.querySelectorAll) menus.push(...scope.querySelectorAll('[role="menu"],.c-menu'));
    menus.forEach((menu) => {
      const message = msgFiber(menu);
      if (!message || !message.ts) return;
      if (!message.channel) message.channel = cur();
      if (isHidden(message.channel, message.ts)) return;
      const edited = logFor(message, 'edited');
      const deleted = logFor(message, 'deleted');
      if (!edited && !deleted) return;
      const items = menu.querySelectorAll('button,[role="menuitem"]');
      const reference = items[items.length - 1];
      if (reference) injectHideItem(menu, reference, message, edited, deleted);
    });
  }

  window.__slickMessageLogger = {
    logs: logs,
    apply: function () {
      scan(document.body || document);
    },
  };

  psocket();
  papi();
  istyle();
  scan(document.body || document);
  xmenu(document.body || document);
  new MutationObserver((mutations) => {
    mutations.forEach((mutation) => {
      if (ispn(mutation.target)) return;
      mutation.addedNodes.forEach((node) => {
        if (ispn(node)) return;
        scan(node);
        xmenu(node);
      });
    });
  }).observe(document.documentElement, { childList: true, subtree: true });
  window.addEventListener('slick:plugin-settings', sscan);
  console.log('[MessageLogger] active');
})();
