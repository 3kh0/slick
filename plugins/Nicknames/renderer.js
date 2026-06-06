(function () {
  'use strict';
  if (window.__slickNicknames) return;

  const KEY = 'slick:nicknames';
  const ID_RE = /^[UW][A-Z0-9]{6,}$/;
  const ID_FIND_RE = /\b[UW][A-Z0-9]{6,}\b/;
  const DIALOG_SEL = '#slick-fn-dialog, [data-slick-fn-action]';

  const NAME = [
    '.p-r_member_profile__name',
    '.c-message__sender_button',
    '.c-message__sender',
    '.c-member_slug__name',
    '.c-member__name',
    '.c-member_name',
    '[data-qa="message_sender"]',
    '[data-qa="message_sender_name"]',
    '[data-qa="member_name"]',
    '[data-qa="member_display_name"]',
    '[data-qa="member-real-name"]',
    '[data-qa="member_real_name"]',
    '[data-qa="user_name"]',
    '[data-qa="user_profile_name"]',
    '[data-qa="member_profile_name"]',
    '[data-stringify-type="mention"]',
  ];
  const SURFACE =
    '[data-qa="member_profile_pane"], .p-r_member_profile__container, .p-member_profile_hover_card__container';
  const PROFILE = [
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
  ];
  const ACT = [
    '.p-member_profile_buttons',
    '.p-r_member_profile__buttons',
    '[data-qa="member_profile_actions"]',
    '[data-qa="profile_actions"]',
    '[data-qa*="profile_actions"]',
    '.p-member_profile__actions',
    '.p-member_profile_popover__actions',
    '.c-member_profile__actions',
    '[role="toolbar"]',
  ];

  let nicknames = read();
  window.__slickNicknames = {
    get: (id) => nicknames[id] || '',
    set(id, name) {
      if (!ID_RE.test(id)) return false;
      setNickname(id, name);
      return true;
    },
    all: () => ({ ...nicknames }),
    apply: () => applyAll(),
  };

  function read() {
    let raw;
    try {
      raw = JSON.parse(localStorage.getItem(KEY)) || {};
    } catch {
      return {};
    }
    const clean = {};
    for (const [k, val] of Object.entries(raw)) {
      const v = normalize(val);
      if (ID_RE.test(k) && v) clean[k] = v;
    }
    return clean;
  }

  function write() {
    try {
      localStorage.setItem(KEY, JSON.stringify(nicknames));
    } catch {}
  }

  function normalize(value) {
    return String(value ?? '')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 24);
  }

  function setNickname(id, value) {
    const nick = normalize(value);
    if (nick) nicknames[id] = nick;
    else delete nicknames[id];
    write();
    applyAll();
  }

  function fiberOf(el) {
    if (!el) return null;
    const k = Object.keys(el).find(
      (key) => key.startsWith('__reactFiber$') || key.startsWith('__reactInternalInstance$'),
    );
    return k ? el[k] : null;
  }

  function stringId(value) {
    return typeof value === 'string' && ID_RE.test(value) ? value : null;
  }

  function idInText(value) {
    return (typeof value === 'string' && value.match(ID_FIND_RE)?.[0]) || null;
  }

  function pickId(obj, keys) {
    for (const k of keys) {
      const id = stringId(obj[k]);
      if (id) return id;
    }
    return null;
  }

  function idFromProps(props) {
    if (!props || typeof props !== 'object') return null;
    const direct = pickId(props, [
      'userId',
      'user_id',
      'memberId',
      'member_id',
      'authorUserId',
      'senderUserId',
      'actorUserId',
      'participantId',
      'id',
    ]);
    if (direct) return direct;
    for (const key of ['user', 'member', 'profile', 'author', 'sender', 'actor', 'participant', 'person', 'entity']) {
      const obj = props[key];
      if (!obj || typeof obj !== 'object') continue;
      const id = pickId(obj, ['id', 'userId', 'user_id', 'memberId', 'member_id']);
      if (id) return id;
    }
    return null;
  }

  function fiberUserId(el) {
    let f = fiberOf(el);
    let hops = 0;
    let fallback = null;
    while (f && hops < 30) {
      for (const props of [f.memoizedProps, f.pendingProps]) {
        const id = idFromProps(props);
        if (!id) continue;
        if (!fallback) fallback = id;
        if (props.user || props.member || props.userId || props.user_id || props.memberId || props.member_id) return id;
      }
      f = f.return;
      hops++;
    }
    return fallback;
  }

  function attrUserId(el) {
    for (const attr of [
      'data-user-id',
      'data-member-id',
      'data-qa-user-id',
      'data-qa-member-id',
      'data-stringify-id',
      'href',
      'aria-controls',
    ]) {
      const id = stringId(el.getAttribute(attr)) || idInText(el.getAttribute(attr));
      if (id) return id;
    }
    return null;
  }

  function userIdOf(el) {
    if (!el || el.nodeType !== Node.ELEMENT_NODE) return null;
    const injectedId = el.dataset && el.dataset.slickFnAction && stringId(el.dataset.slickFnUserId);
    if (injectedId) return injectedId;
    let cur = el;
    let hops = 0;
    while (cur && cur.nodeType === Node.ELEMENT_NODE && hops < 6) {
      const id = attrUserId(cur) || fiberUserId(cur);
      if (id) return id;
      cur = cur.parentElement;
      hops++;
    }
    return null;
  }

  function visible(el) {
    if (!el || el.nodeType !== Node.ELEMENT_NODE) return false;
    const st = getComputedStyle(el);
    return st.display !== 'none' && st.visibility !== 'hidden';
  }

  function nameTextNode(el) {
    if (!visible(el) || el.closest(DIALOG_SEL)) return null;
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT, {
      acceptNode(node) {
        const trimmed = node.nodeValue.trim();
        if (!trimmed || trimmed.length > 120 || trimmed.includes('\n')) return NodeFilter.FILTER_REJECT;
        const parent = node.parentElement;
        if (!parent || !visible(parent) || parent.closest(DIALOG_SEL)) return NodeFilter.FILTER_REJECT;
        return NodeFilter.FILTER_ACCEPT;
      },
    });
    return walker.nextNode();
  }

  function withOriginalShape(original, nick) {
    const leading = original.match(/^\s*/)[0];
    const trailing = original.match(/\s*$/)[0];
    const trimmed = original.trim();
    const label = trimmed.startsWith('@') ? '@' + nick : nick;
    return leading + label + trailing;
  }

  function restorePatched(node, holder) {
    if (!holder.dataset.slickFnPatched) return;
    const original = holder.dataset.slickFnOriginalName;
    if (original !== undefined && node.nodeValue !== original) node.nodeValue = original;
    delete holder.dataset.slickFnOriginalName;
    delete holder.dataset.slickFnPatched;
  }

  function restoreTitle(el) {
    if (!el.dataset || !('slickFnOriginalTitle' in el.dataset)) return;
    const original = el.dataset.slickFnOriginalTitle;
    if (original) el.setAttribute('title', original);
    else el.removeAttribute('title');
    delete el.dataset.slickFnOriginalTitle;
  }

  function setNicknameTitle(el, original) {
    if (!el.dataset) return;
    if (!('slickFnOriginalTitle' in el.dataset)) el.dataset.slickFnOriginalTitle = el.getAttribute('title') || '';
    el.title = original.trim();
  }

  function applyName(el) {
    const id = userIdOf(el);
    if (!id) return;
    const node = nameTextNode(el);
    if (!node) return;
    const holder = node.parentElement || el;
    if (!holder.dataset) return;

    if (holder.dataset.slickFnPatched && holder.dataset.slickFnPatched !== id) restorePatched(node, holder);

    const nick = nicknames[id];
    if (!nick) {
      restorePatched(node, holder);
      restoreTitle(el);
      el.classList.remove('slick-fn--nicknamed');
      return;
    }

    if (holder.dataset.slickFnPatched !== id) {
      holder.dataset.slickFnOriginalName = node.nodeValue;
      holder.dataset.slickFnPatched = id;
    }
    const original = holder.dataset.slickFnOriginalName || node.nodeValue;
    const next = withOriginalShape(original, nick);
    if (node.nodeValue !== next) node.nodeValue = next;
    el.classList.add('slick-fn--nicknamed');
    setNicknameTitle(el, original);
  }

  function profileRoots() {
    const roots = new Set();
    for (const sel of PROFILE) {
      for (const el of document.querySelectorAll(sel)) {
        const surface = el.closest(SURFACE);
        if (surface) {
          roots.add(surface);
          continue;
        }
        if (el.closest('button') || /(_field|_btn)/.test(el.getAttribute('data-qa') || '')) continue;
        roots.add(el);
      }
    }
    const all = [...roots];
    return all.filter((el) => !all.some((other) => other !== el && other.contains(el))).filter((el) => userIdOf(el));
  }

  function actionHost(root) {
    for (const sel of ACT) {
      const host = root.querySelector(sel);
      if (host) return host;
    }
    const buttons = [...root.querySelectorAll('button:not([data-slick-fn-action])')].filter((btn) => visible(btn));
    let best = null;
    let bestCount = 1;
    for (const btn of buttons) {
      const parent = btn.parentElement;
      if (!parent) continue;
      const count = parent.querySelectorAll('button').length;
      if (count > bestCount && count <= 6) {
        best = parent;
        bestCount = count;
      }
    }
    return best || root;
  }

  function profileName(root, id) {
    for (const sel of NAME) {
      const el = root.querySelector(sel);
      if (!el || userIdOf(el) !== id) continue;
      const node = nameTextNode(el);
      if (!node) continue;
      const holder = node.parentElement || el;
      const original = holder.dataset && holder.dataset.slickFnPatched ? holder.dataset.slickFnOriginalName : null;
      return (original ?? node.nodeValue).trim().replace(/^@/, '');
    }
    return id;
  }

  // stolen from the workflows page
  const PEN =
    '<svg class="slick-fn-icon" width="16" height="16" viewBox="0 0 20 20" aria-hidden="true" focusable="false">' +
    '<path fill="currentColor" fill-rule="evenodd" clip-rule="evenodd" d="M13.616 3.444a1.25 1.25 0 0 1 1.768 0l1.171 1.172a1.25 1.25 0 0 1 0 1.768L15.5 7.439l-2.94-2.94zM11.5 5.56l-7.079 7.08-1.102 4.04 4.041-1.1 7.078-7.08zm4.945-3.176a2.75 2.75 0 0 0-3.89 0L3.22 11.719a.75.75 0 0 0-.194.333l-1.5 5.5a.75.75 0 0 0 .921.921l5.5-1.5a.75.75 0 0 0 .333-.193l9.336-9.336a2.75 2.75 0 0 0 0-3.889z"/>' +
    '</svg>';

  function buttonLabel(id) {
    return nicknames[id] ? 'Edit nickname' : 'Set nickname';
  }

  function setButtonLabel(btn, id) {
    const text = buttonLabel(id);
    const label = btn.querySelector('.slick-fn-label');
    if (label && label.textContent !== text) label.textContent = text;
    btn.setAttribute('aria-label', text);
    btn.title = text;
  }

  function injectProfileAction(root) {
    const id = userIdOf(root);
    if (!id || root.querySelector('[data-slick-fn-action]')) return;

    const host = actionHost(root);
    const btn = document.createElement('button');
    btn.type = 'button';
    const size = host.querySelector('.c-button--small') ? 'small' : 'medium';
    btn.className = 'c-button c-button--outline c-button--' + size + ' slick-fn-profile-action';
    btn.dataset.slickFnAction = '1';
    btn.dataset.slickFnUserId = id;
    btn.innerHTML = PEN + '<span class="slick-fn-label"></span>';
    setButtonLabel(btn, id);
    btn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      openEditor(id, profileName(root, id));
    });
    host.appendChild(btn);
  }

  function ensureStyle() {
    if (document.getElementById('slick-fn-style')) return;
    const style = document.createElement('style');
    style.id = 'slick-fn-style';
    style.textContent = [
      '.slick-fn-profile-action{display:inline-flex;align-items:center;gap:4px;margin-left:8px;min-width:0;max-width:160px}',
      '.slick-fn-profile-action .slick-fn-icon{flex:none}',
      '.slick-fn-profile-action .slick-fn-label{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
      '#slick-fn-dialog{position:fixed;inset:0;z-index:2147483647;display:flex;align-items:center;justify-content:center;background:rgba(0,0,0,.35)}',
      '#slick-fn-dialog .slick-fn-modal{box-sizing:border-box;width:min(420px,calc(100vw - 32px));padding:20px;border-radius:8px;background:var(--sk_primary_background,#1d1c1d);color:var(--sk_primary_foreground,#d1d2d3);box-shadow:0 18px 48px rgba(0,0,0,.35)}',
      '#slick-fn-dialog h3{margin:0 0 14px;font-size:18px;line-height:24px;font-weight:700}',
      '#slick-fn-dialog label{display:block;margin:0 0 8px;font-weight:700}',
      '#slick-fn-dialog input{box-sizing:border-box;width:100%;height:36px;margin:0 0 16px;padding:0 10px;border:1px solid rgba(127,127,127,.45);border-radius:4px;background:var(--sk_primary_background,#1d1c1d);color:inherit;font:inherit;outline:none}',
      '#slick-fn-dialog input:focus{border-color:var(--p-focus-ring-color,#1264a3);box-shadow:0 0 0 1px var(--p-focus-ring-color,#1264a3)}',
      '#slick-fn-dialog .slick-fn-actions{display:flex;gap:8px;justify-content:flex-end}',
    ].join('\n');
    document.head.appendChild(style);
  }

  function closeEditor() {
    const dialog = document.getElementById('slick-fn-dialog');
    if (dialog) dialog.remove();
  }

  function openEditor(id, fallbackName) {
    ensureStyle();
    closeEditor();

    const dialog = document.createElement('div');
    dialog.id = 'slick-fn-dialog';
    dialog.innerHTML =
      '<div class="slick-fn-modal" role="dialog" aria-modal="true" aria-labelledby="slick-fn-title">' +
      '<h3 id="slick-fn-title">Nickname</h3>' +
      '<label for="slick-fn-input">Nickname</label>' +
      '<input id="slick-fn-input" class="c-input_text" maxlength="24" autocomplete="off">' +
      '<div class="slick-fn-actions">' +
      '<button type="button" class="c-button c-button--medium" data-slick-fn-cancel>Cancel</button>' +
      '<button type="button" class="c-button c-button--medium" data-slick-fn-remove>Remove</button>' +
      '<button type="button" class="c-button c-button--primary c-button--medium" data-slick-fn-save>Save</button>' +
      '</div>' +
      '</div>';
    document.body.appendChild(dialog);

    const input = dialog.querySelector('#slick-fn-input');
    const remove = dialog.querySelector('[data-slick-fn-remove]');
    input.value = nicknames[id] || '';
    input.placeholder = fallbackName || id;
    remove.style.display = nicknames[id] ? '' : 'none';
    input.focus();
    input.select();

    const save = () => {
      setNickname(id, input.value);
      closeEditor();
    };
    dialog.querySelector('[data-slick-fn-save]').addEventListener('click', save);
    dialog.querySelector('[data-slick-fn-cancel]').addEventListener('click', closeEditor);
    remove.addEventListener('click', () => {
      setNickname(id, '');
      closeEditor();
    });
    dialog.addEventListener('click', (e) => {
      if (e.target === dialog) closeEditor();
    });
    dialog.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') closeEditor();
      else if (e.key === 'Enter') save();
    });
  }

  function applyAll() {
    ensureStyle();
    for (const sel of NAME) document.querySelectorAll(sel).forEach(applyName);
    profileRoots().forEach(injectProfileAction);
    document.querySelectorAll('[data-slick-fn-action]').forEach((btn) => {
      const id = userIdOf(btn);
      if (id) setButtonLabel(btn, id);
    });
  }

  let t = null;
  const obs = new MutationObserver(() => {
    if (t) return;
    t = setTimeout(() => {
      t = null;
      applyAll();
    }, 150);
  });

  window.addEventListener('storage', (e) => {
    if (e.key !== KEY) return;
    nicknames = read();
    applyAll();
  });

  function boot() {
    if (!document.body) {
      setTimeout(boot, 200);
      return;
    }
    applyAll();
    obs.observe(document.body, { subtree: true, childList: true, characterData: true });
  }
  boot();
})();
