(function () {
  'use strict';
  if (window.__slickAdminBackend) return;
  window.__slickAdminBackend = true;
  const SELECTOR = [
    '[data-qa="member_profile_pane"]',
    '.p-r_member_profile__container',
    '.p-member_profile_hover_card__container',
    '[data-qa="member_profile"]',
    '[data-qa="member_profile_popover"]',
    '[data-qa="user_profile"]',
    '.p-member_profile',
    '.p-member_profile_popover',
  ].join(',');
  const ACTIONS = [
    ['identity', 'Open in Identity'],
    ['joe', 'Open in Joe'],
  ];
  let profileId = null;
  function stringId(value) {
    return typeof value === 'string' && /^[UW][A-Z0-9]{6,}$/.test(value) ? value : null;
  }
  function idFromProps(props) {
    if (!props || typeof props !== 'object') return null;
    for (const key of ['userId', 'user_id', 'memberId', 'member_id', 'id']) {
      const id = stringId(props[key]);
      if (id) return id;
    }
    for (const key of ['user', 'member', 'profile', 'person']) {
      const value = props[key];
      if (!value || typeof value !== 'object') continue;
      for (const idKey of ['id', 'userId', 'user_id', 'memberId', 'member_id']) {
        const id = stringId(value[idKey]);
        if (id) return id;
      }
    }
    return null;
  }
  function userIdOf(element) {
    for (let current = element, hops = 0; current && hops < 7; current = current.parentElement, hops++) {
      for (const attribute of ['data-user-id', 'data-member-id', 'data-qa-user-id', 'href', 'aria-controls']) {
        const value = current.getAttribute(attribute);
        const id = stringId(value) || (typeof value === 'string' && value.match(/\b[UW][A-Z0-9]{6,}\b/)?.[0]);
        if (id) return id;
      }

      const key = Object.keys(current).find((name) => name.startsWith('__reactFiber$'));
      for (let fiber = key && current[key], depth = 0; fiber && depth < 30; fiber = fiber.return, depth++) {
        const id = idFromProps(fiber.memoizedProps) || idFromProps(fiber.pendingProps);
        if (id) return id;
      }
    }
    return null;
  }

  function visible(element) {
    if (!element) return false;
    const style = getComputedStyle(element);
    return style.display !== 'none' && style.visibility !== 'hidden';
  }

  function itemRow(item, menu) {
    const wrapper = item.closest('li,.c-menu_item__li');
    return wrapper && menu.contains(wrapper) ? wrapper : item;
  }

  function stripHighlight(root) {
    if (!root) return;
    for (const element of [root, ...root.querySelectorAll('*')]) {
      if (element.classList) {
        const toRemove = [];
        for (const cls of element.classList) {
          if (/highlight|selected/i.test(cls)) toRemove.push(cls);
        }
        for (const cls of toRemove) element.classList.remove(cls);
      }
      if (element.getAttribute && element.getAttribute('aria-selected') === 'true') {
        element.setAttribute('aria-selected', 'false');
      }
      if (element.removeAttribute) element.removeAttribute('aria-current');
    }
  }

  function injectMenu(menu, reference) {
    const id = userIdOf(menu) || userIdOf(reference) || profileId;
    if (!id) return;

    const existing = menu.querySelector('[data-slick-admin-backend]');
    if (existing && existing.dataset.slickAdminBackendUser === id) return;
    menu.querySelectorAll('[data-slick-admin-backend]').forEach((element) => element.remove());

    const rows = ACTIONS.flatMap(([target, label]) => {
      const clone = itemRow(reference, menu).cloneNode(true);
      const item = clone.matches('button,[role="menuitem"]') ? clone : clone.querySelector('button,[role="menuitem"]');
      if (!item) return [];

      clone.dataset.slickAdminBackend = target;
      clone.querySelectorAll('[id]').forEach((element) => element.removeAttribute('id'));
      for (const attribute of ['data-qa', 'aria-controls', 'aria-describedby', 'aria-expanded', 'aria-haspopup']) {
        item.removeAttribute(attribute);
      }
      stripHighlight(clone);

      item.addEventListener('mouseenter', () => {
        for (const other of menu.querySelectorAll('button,[role="menuitem"]')) {
          if (other !== item) stripHighlight(itemRow(other, menu));
        }
      });

      const labelElement = item.querySelector('.c-menu_item__label');
      if (labelElement) labelElement.textContent = label;
      else item.textContent = label;

      item.addEventListener('click', (event) => {
        event.preventDefault();
        event.stopPropagation();
        window.location.assign(`https://slick.admin-backend/open?${new URLSearchParams({ target, id })}`);
      });
      return [clone];
    });
    for (const row of rows) row.dataset.slickAdminBackendUser = id;
    itemRow(reference, menu).after(...rows);
  }

  function within(root, selector) {
    const found = [];
    if (root.nodeType === Node.ELEMENT_NODE && root.matches(selector)) found.push(root);
    if (root.querySelectorAll) found.push(...root.querySelectorAll(selector));
    return found;
  }

  function x(root = document) {
    for (const profile of within(root, SELECTOR)) {
      const id = visible(profile) && userIdOf(profile);
      if (id) profileId = id;
    }
    for (const item of within(root, 'button,[role="menuitem"]')) {
      if (item.textContent.replace(/\s+/g, ' ').trim() !== 'Copy link to profile' || !visible(item)) continue;
      const menu = item.closest('[role="menu"],.c-menu');
      if (menu) injectMenu(menu, item);
    }
  }

  let timer = null;
  const pendingRoots = new Set();
  function queue(root) {
    if (root.nodeType !== Node.ELEMENT_NODE) return;
    for (const pending of pendingRoots) {
      if (pending.contains(root)) return;
      if (root.contains(pending)) pendingRoots.delete(pending);
    }
    pendingRoots.add(root);
  }
  const observer = new MutationObserver((mutations) => {
    mutations.forEach((mutation) => mutation.addedNodes.forEach(queue));
    if (!pendingRoots.size) return;
    if (timer) return;
    timer = setTimeout(() => {
      timer = null;
      const roots = [...pendingRoots];
      pendingRoots.clear();
      roots.forEach(x);
    }, 100);
  });

  function boot() {
    if (!document.body) {
      setTimeout(boot, 200);
      return;
    }
    if (!document.getElementById('slick-admin-backend-style')) {
      const style = document.createElement('style');
      style.id = 'slick-admin-backend-style';
      style.textContent = [
        '[data-slick-admin-backend]{cursor:pointer}',
        '[data-slick-admin-backend]:hover,[data-slick-admin-backend]:focus-within{background:var(--p-focus-ring-color,#1264a3)!important;color:#fff!important}',
        '[data-slick-admin-backend]:hover *,[data-slick-admin-backend]:focus-within *{color:#fff!important}',
        '[data-slick-admin-backend] button,[data-slick-admin-backend] [role="menuitem"]{cursor:pointer}',
      ].join('\n');
      document.head.appendChild(style);
    }
    x();
    observer.observe(document.body, { childList: true, subtree: true });
  }

  boot();
})();
