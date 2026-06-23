(function () {
  'use strict';
  if (window.__slickLastSeen) return;

  const ID_RE = /^[UW][A-Z0-9]{6,}$/;
  const SURF =
    '[data-qa="member_profile_pane"], .p-r_member_profile__container, .p-member_profile_hover_card__container';
  const ROW_SEL = [
    '.c-message_kit__message',
    '.c-message',
    '[data-qa="message_container"]',
    '[id^="message-list_"][role="listitem"]',
  ].join(',');

  const S = () => (window.__slickPluginSettings && window.__slickPluginSettings.LastSeen) || {};
  const ttl = () => {
    const h = Number(S().cacheTtlHours);
    return (h > 0 ? h : 168) * 3600e3;
  };

  let C = load();
  let svT = 0;
  function load() {
    try {
      const r = JSON.parse(localStorage.getItem('slick:lastseen:cache'));
      return r && typeof r === 'object' ? r : {};
    } catch {
      return {};
    }
  }
  function save() {
    if (svT) return;
    svT = setTimeout(() => {
      svT = 0;
      try {
        const cut = Date.now() - ttl();
        for (const id in C) if (!C[id] || (C[id].updatedAt || 0) < cut) delete C[id];
        const ids = Object.keys(C);
        if (ids.length > 2000) {
          ids.sort((a, b) => (C[a].updatedAt || 0) - (C[b].updatedAt || 0));
          for (const id of ids.slice(0, ids.length - 2000)) delete C[id];
        }
        localStorage.setItem('slick:lastseen:cache', JSON.stringify(C));
      } catch {}
    }, 1000);
  }
  const ent = (id) => C[id] || (C[id] = {});

  function markMsg(id, ts) {
    if (!ID_RE.test(id) || !ts) return;
    const n = parseFloat(ts);
    if (!n) return;
    const e = ent(id);
    const prev = parseFloat(e.lastMessageTs || '0');
    if (prev && prev >= n) return;
    const t = Date.now();
    e.lastMessageTs = String(ts);
    e.updatedAt = t;
    save();
    sched();
  }

  function onP(u, p) {
    if (!ID_RE.test(u) || (p !== 'active' && p !== 'away')) return;
    const e = ent(u);
    const t = Date.now();
    e.presence = p;
    e.updatedAt = t;
    if (p === 'active') e.lastActive = t;
    else e.lastAway = t;
    save();
    sched();
  }
  function msgTs(m) {
    return m && typeof m === 'object' ? m.ts || m.event_ts || m.message_ts || '' : '';
  }
  function msgUser(m) {
    return m && typeof m === 'object' ? m.user || m.user_id || m.sender || m.authorUserId || '' : '';
  }
  function msgFrame(o) {
    if (!o || typeof o !== 'object') return;
    const m =
      o.message && typeof o.message === 'object' ? o.message : o.event && typeof o.event === 'object' ? o.event : o;
    if (m.type && m.type !== 'message') return;
    if (m.subtype === 'message_deleted') return;
    markMsg(msgUser(m), msgTs(m));
  }
  function frame(o) {
    if (!o || typeof o !== 'object') return;
    if (o.type === 'presence_change') {
      const p = o.presence;
      if (Array.isArray(o.users)) o.users.forEach((u) => onP(u, p));
      else if (o.user) onP(o.user, p);
    } else msgFrame(o);
  }

  const SK = [];
  function onMsg(ev) {
    const d = ev && ev.data;
    if (typeof d !== 'string' || (d.indexOf('presence_change') === -1 && d.indexOf('"message"') === -1)) return;
    try {
      frame(JSON.parse(d));
    } catch {}
  }
  function patchWS() {
    const N = window.WebSocket;
    if (!N || N.__slickLastSeenPatched) return;
    const armed = new WeakSet();
    const add = N.prototype.addEventListener;
    function arm(s) {
      if (!s || armed.has(s)) return;
      armed.add(s);
      SK.push(s);
      if (SK.length > 8) SK.shift();
      try {
        add.call(s, 'message', onMsg, true);
      } catch {}
    }
    function W(u, p) {
      const s = p === undefined ? new N(u) : new N(u, p);
      arm(s);
      return s;
    }
    try {
      Object.setPrototypeOf(W, N);
    } catch {}
    W.prototype = N.prototype;
    ['CONNECTING', 'OPEN', 'CLOSING', 'CLOSED'].forEach((k) => {
      try {
        Object.defineProperty(W, k, { value: N[k] });
      } catch {}
    });
    N.prototype.addEventListener = function (type) {
      if (type === 'message') arm(this);
      return add.apply(this, arguments);
    };
    try {
      const d = Object.getOwnPropertyDescriptor(N.prototype, 'onmessage');
      if (d && d.configurable) {
        Object.defineProperty(N.prototype, 'onmessage', {
          configurable: true,
          enumerable: d.enumerable,
          get() {
            return d.get ? d.get.call(this) : undefined;
          },
          set(v) {
            arm(this);
            if (d.set) d.set.call(this, v);
          },
        });
      }
    } catch {}
    W.__slickLastSeenPatched = true;
    window.WebSocket = W;
  }
  function openSk() {
    for (let i = SK.length - 1; i >= 0; i--) {
      try {
        if (SK[i] && SK[i].readyState === 1) return SK[i];
      } catch {}
    }
    return null;
  }

  const WL = new Set();
  let subT = 0;
  function watch(id) {
    if (!S().trackWatchlist || !ID_RE.test(id) || WL.has(id)) return;
    WL.add(id);
    while (WL.size > 500) WL.delete(WL.values().next().value);
    if (subT) return;
    subT = setTimeout(() => {
      subT = 0;
      const s = openSk();
      if (!s) return;
      const ids = [...WL].slice(0, 500);
      try {
        s.send(JSON.stringify({ type: 'presence_query', ids }));
        s.send(JSON.stringify({ type: 'presence_sub', ids }));
      } catch {}
    }, 500);
  }

  const tried = new Map();
  function token() {
    try {
      const t = window.boot_data && window.boot_data.api_token;
      if (typeof t === 'string' && t) return t;
    } catch {}
    try {
      const c = JSON.parse(localStorage.getItem('localConfig_v2'));
      const tm = c && c.teams;
      if (tm) {
        const a = c.lastActiveTeamId || (location.pathname.match(/\/client\/([A-Z0-9]+)/) || [])[1];
        if (a && tm[a] && tm[a].token) return tm[a].token;
        for (const k in tm) if (tm[k] && tm[k].token) return tm[k].token;
      }
    } catch {}
    try {
      const t = window.TS && window.TS.boot_data && window.TS.boot_data.api_token;
      if (typeof t === 'string' && t) return t;
    } catch {}
    return null;
  }
  async function fetchMsg(id) {
    if (!S().showLastMessage || !ID_RE.test(id)) return;
    const e = ent(id);
    if (e.lastMessageAt && Date.now() - e.lastMessageAt < Math.min(ttl(), 5 * 60e3)) return;
    const tr = tried.get(id);
    if (tr && Date.now() - tr < 6e4) return;
    tried.set(id, Date.now());
    const tk = token();
    if (!tk) return;
    try {
      const f = new FormData();
      f.set('token', tk);
      f.set('query', 'from:<@' + id + '>');
      f.set('sort', 'timestamp');
      f.set('sort_dir', 'desc');
      f.set('count', '1');
      const r = await fetch('/api/search.messages', { method: 'POST', body: f, credentials: 'include' });
      if (!r.ok) return;
      const d = await r.json();
      const ts = d && d.messages && d.messages.matches && d.messages.matches[0] && d.messages.matches[0].ts;
      if (ts) markMsg(id, ts);
      const now = Date.now();
      const latest = ent(id);
      latest.lastMessageAt = latest.updatedAt = now;
      save();
    } catch {}
  }

  function rel(ms) {
    if (!ms) return '';
    const d = Date.now() - ms;
    if (d < 0) return 'just now';
    const s = (d / 1000) | 0;
    if (s < 45) return 'just now';
    const m = (s / 60) | 0;
    if (m < 60) return m + 'm';
    const h = (m / 60) | 0;
    if (h < 24) return h + 'h';
    const dy = (h / 24) | 0;
    return dy <= 30 ? dy + 'd' : '>30d';
  }
  const exact = (ms) => {
    try {
      return new Date(ms).toLocaleString();
    } catch {
      return '';
    }
  };

  const fib = (el) => {
    if (!el) return null;
    const k = Object.keys(el).find((x) => x.startsWith('__reactFiber$') || x.startsWith('__reactInternalInstance$'));
    return k ? el[k] : null;
  };
  const sid = (v) => (typeof v === 'string' && ID_RE.test(v) ? v : null);
  const pick = (o, ks) => {
    for (const k of ks) {
      const id = sid(o[k]);
      if (id) return id;
    }
    return null;
  };
  function idp(p) {
    if (!p || typeof p !== 'object') return null;
    const d = pick(p, ['userId', 'user_id', 'memberId', 'member_id', 'authorUserId', 'senderUserId', 'id']);
    if (d) return d;
    for (const k of ['user', 'member', 'profile', 'author', 'sender', 'participant', 'person']) {
      const o = p[k];
      if (o && typeof o === 'object') {
        const id = pick(o, ['id', 'userId', 'user_id', 'memberId', 'member_id']);
        if (id) return id;
      }
    }
    return null;
  }
  function fid(el) {
    let f = fib(el);
    let fb = null;
    for (let h = 0; f && h < 30; f = f.return, h++)
      for (const p of [f.memoizedProps, f.pendingProps]) {
        const id = idp(p);
        if (!id) continue;
        fb ||= id;
        if (p.user || p.member || p.userId || p.user_id || p.memberId || p.member_id) return id;
      }
    return fb;
  }
  function msgFromProps(p) {
    if (!p || typeof p !== 'object') return null;
    const m = p.message || p.msg || p.event;
    if (m && typeof m === 'object' && msgTs(m)) return { ts: msgTs(m), user: msgUser(m) };
    if (p.ts || p.messageTs || p.message_ts) {
      return { ts: p.ts || p.messageTs || p.message_ts, user: p.user || p.userId || p.user_id || '' };
    }
    return null;
  }
  function rowMsg(el) {
    const scan = (node) => {
      let f = fib(node);
      for (let h = 0; f && h < 40; f = f.return, h++) {
        const m = msgFromProps(f.memoizedProps) || msgFromProps(f.pendingProps);
        if (m) return m;
      }
      return null;
    };
    let m = scan(el);
    if (m) return m;
    const nodes = el.querySelectorAll('*');
    for (let i = 0; i < nodes.length && i < 80; i++) {
      m = scan(nodes[i]);
      if (m) return m;
    }
    const attr = el.getAttribute('data-ts') || el.getAttribute('data-message-ts') || el.id || '';
    const ts = String(attr).match(/\d{10}\.\d{6}/);
    if (!ts) return null;
    const sender = el.querySelector(
      '.c-message__sender, .c-message__sender_button, [data-qa="message_sender"], [data-qa="message_sender_name"]',
    );
    return { ts: ts[0], user: sender ? uid(sender) : uid(el) };
  }
  function scanMessages() {
    if (!S().showLastMessage) return;
    document.querySelectorAll(ROW_SEL).forEach((row) => {
      const m = rowMsg(row);
      if (m) markMsg(m.user, m.ts);
    });
  }
  const aid = (el) => {
    for (const a of ['data-user-id', 'data-member-id', 'data-qa-user-id', 'data-qa-member-id', 'data-stringify-id']) {
      const id = sid(el.getAttribute && el.getAttribute(a));
      if (id) return id;
    }
    return null;
  };
  function uid(el) {
    if (!el || el.nodeType !== 1) return null;
    for (let c = el, h = 0; c && c.nodeType === 1 && h < 6; c = c.parentElement, h++) {
      const id = aid(c) || fid(c);
      if (id) return id;
    }
    return null;
  }

  function roots() {
    const r = new Set();
    for (const sel of [
      '[data-qa="member_profile_pane"]',
      '.p-r_member_profile__container',
      '.p-member_profile_hover_card__container',
      '[data-qa="member_profile"]',
      '[data-qa="member_profile_popover"]',
      '[data-qa="member_profile_container"]',
      '[data-qa="member_profile_view"]',
      '[data-qa="user_profile"]',
      '[data-qa="user_profile_popover"]',
      '[data-qa*="member_profile"]',
      '[data-qa*="user_profile"]',
      '.p-member_profile',
      '.p-member_profile_popover',
      '.c-member_profile',
    ]) {
      let f;
      try {
        f = document.querySelectorAll(sel);
      } catch {
        continue;
      }
      for (const el of f) {
        const s = el.closest(SURF);
        if (s) {
          r.add(s);
          continue;
        }
        if (el.closest('button') || /(_field|_btn)/.test(el.getAttribute('data-qa') || '')) continue;
        r.add(el);
      }
    }
    const a = [...r];
    return a.filter((el) => !a.some((o) => o !== el && o.contains(el))).filter(uid);
  }

  function style() {
    if (document.getElementById('slick-ls-style')) return;
    const s = document.createElement('style');
    s.id = 'slick-ls-style';
    s.textContent =
      '.slick-ls-block{margin:10px 0 2px;padding-top:8px;border-top:1px solid rgba(127,127,127,.18);font-size:13px;line-height:1.5}' +
      '.slick-ls-line{display:block;color:rgba(var(--sk_foreground_high_solid,134,134,134),1)}' +
      '.slick-ls-label{opacity:.72;margin-right:4px}.slick-ls-muted{opacity:.7;font-style:italic}';
    (document.head || document.documentElement).appendChild(s);
  }

  function lines(id) {
    const s = S();
    const e = C[id] || {};
    const o = [];
    if (s.showLastMessage && e.lastMessageTs) {
      const ms = parseFloat(e.lastMessageTs) * 1000;
      if (ms) o.push({ label: 'Last message:', text: rel(ms), title: exact(ms) });
    }
    if (s.showObservedPresence) {
      if (e.presence === 'active')
        o.push({ label: 'Last seen online:', text: 'active now (observed)', title: 'Observed active right now' });
      else if (e.lastActive)
        o.push({
          label: 'Last seen online:',
          text: '~' + rel(e.lastActive) + ' (observed)',
          title: 'Approximate — last time Slick saw them go/be active: ' + exact(e.lastActive),
        });
      else o.push({ label: 'Last seen online:', muted: true, text: 'not observed yet' });
    }
    return o.length ? o : null;
  }
  function updBlk(b, id) {
    const data = lines(id);
    if (!data) return b.remove();
    b.textContent = '';
    b.dataset.slickLs = id;
    for (const ln of data) {
      const line = document.createElement('span');
      line.className = 'slick-ls-line';
      if (ln.title) line.title = ln.title;
      const lab = document.createElement('span');
      lab.className = 'slick-ls-label';
      lab.textContent = ln.label;
      const v = document.createElement('span');
      if (ln.muted) v.className = 'slick-ls-muted';
      v.textContent = ln.text;
      line.append(lab, v);
      b.appendChild(line);
    }
  }

  const plabel = (root) => {
    const i = root.querySelector('[data-qa="presence_indicator"]');
    return ((i && (i.getAttribute('aria-label') || i.getAttribute('title'))) || '').trim();
  };
  function ptn(root) {
    const dot =
      root.querySelector('.c-presence, [class*="c-presence"]') ||
      (root.querySelector('[data-qa="presence_indicator"]') || {}).parentElement;
    if (!dot || !dot.parentElement) return null;
    const lab = plabel(root);
    try {
      return document
        .createTreeWalker(dot.parentElement, NodeFilter.SHOW_TEXT, {
          acceptNode(n) {
            const t = (n.nodeValue || '').trim();
            if (!t || t.length > 80) return 2;
            const pe = n.parentElement;
            if (
              !pe ||
              dot.contains(pe) ||
              pe.closest(
                '.p-r_member_profile__name,.p-r_member_profile__name__text,.p-member_profile_base_entity__name,.c-message__sender_button,.c-message__sender,.c-member_slug__name,.c-member__name,.c-member_name,.c-base_entity__text,[data-qa="message_sender"],[data-qa="member_name"]',
              )
            )
              return 2;
            const ok =
              t.startsWith('Last seen') ||
              (lab ? t === lab || lab.startsWith(t) || t.startsWith(lab) : /^(active|away|offline|online)\b/i.test(t));
            return ok ? 1 : 2;
          },
        })
        .nextNode();
    } catch {
      return null;
    }
  }
  function sActive(root, o) {
    const i = root.querySelector('[data-qa="presence_indicator"]');
    const f = i && i.getAttribute('data-qa-presence-active');
    if (f === 'true') return true;
    if (f === 'false') return false;
    const d = root.querySelector('.c-presence, [class*="c-presence"]');
    if (d && d.classList) {
      if ([...d.classList].some((c) => /--active/.test(c))) return true;
      if ([...d.classList].some((c) => /--away|--offline/.test(c))) return false;
    }
    return /^\s*(active|online)/i.test(o || '');
  }
  const snz = (root, o) => {
    const i = root.querySelector('[data-qa="presence_indicator"]');
    return (i && i.getAttribute('data-qa-presence-dnd') === 'true') || /snoozed/i.test(o || '');
  };

  function rewrite(root, id) {
    const n = ptn(root);
    if (!n) return;
    const h = n.parentElement;
    if (!h || !h.dataset) return;
    const live = String(n.nodeValue == null ? '' : n.nodeValue);
    const mine = live.trimStart().startsWith('Last seen');
    if (!mine) h.dataset.slickLsPresenceOrig = live;
    const orig = h.dataset.slickLsPresenceOrig || '';
    const s = S();
    const e = C[id] || {};
    const act = e.presence === 'active' || sActive(root, orig);
    let best = 0;
    let src = '';
    if (s.showObservedPresence && e.lastActive > best) {
      best = e.lastActive;
      src = 'observed presence';
    }
    if (s.showLastMessage && e.lastMessageTs) {
      const m = parseFloat(e.lastMessageTs) * 1000;
      if (m > best) {
        best = m;
        src = 'their last visible message';
      }
    }
    if (act || !best) {
      if (mine && 'slickLsPresenceOrig' in h.dataset && n.nodeValue !== orig) n.nodeValue = orig;
      return;
    }
    const r = rel(best);
    let txt = r === 'just now' ? 'Last seen just now' : 'Last seen ~' + r + (r === '>30d' ? '' : ' ago');
    if (snz(root, orig)) txt += ', notifications snoozed';
    if (n.nodeValue !== txt) n.nodeValue = txt;
    h.title =
      'Best-effort, observed by Slick — scroll down for details. Source: ' +
      src +
      '. Slack says: ' +
      (orig.trim() || 'Away');
  }

  function paint() {
    const s = S();
    roots().forEach((root) => {
      const id = uid(root);
      if (!id || id === 'USLACKBOT') return;
      if (s.trackWatchlist) watch(id);
      if (s.showLastMessage) fetchMsg(id);
      try {
        rewrite(root, id);
      } catch {}
      let b = root.querySelector('[data-slick-ls]');
      if (b && b.closest(SURF) !== root && !root.contains(b)) b = null;
      if (!b) {
        if (!lines(id)) return;
        b = document.createElement('div');
        b.className = 'slick-ls-block';
        root.appendChild(b);
      }
      updBlk(b, id);
    });
  }
  function pall() {
    style();
    try {
      scanMessages();
      paint();
    } catch {}
  }
  let pT = 0;
  const sched = () => {
    if (pT) return;
    pT = setTimeout(() => {
      pT = 0;
      pall();
    }, 200);
  };

  window.__slickLastSeen = { cache: () => ({ ...C }), repaint: sched };

  function boot() {
    if (!document.body) return setTimeout(boot, 200);
    patchWS();
    pall();
    new MutationObserver(sched).observe(document.body, { subtree: true, childList: true });
    addEventListener('slick:plugin-settings', sched);
    addEventListener('storage', (e) => {
      if (e.key === 'slick:lastseen:cache') {
        C = load();
        sched();
      }
    });
  }
  boot();
})();
