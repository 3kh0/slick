(function () {
  'use strict';

  if (window.__slickStreamerMode) return;

  var DIR = 'StreamerMode';
  var PATCHED = 'slickStreamerModePatched';
  var activeShares = new Set();
  var currentActive = false;
  var lastReported = null;
  var scanTimer = null;

  var ROOT = [
    'slick-streamer-active',
    'slick-streamer-dm-all',
    'slick-streamer-dm-content',
    'slick-streamer-private-channels',
    'slick-streamer-status',
  ];
  var PRIV_CONTAIN = [
    '.p-channel_sidebar__channel--private',
    '[data-qa="channel_sidebar_channel"][aria-label^="Private channel" i]',
    '.p-channel_sidebar [role="treeitem"][aria-label*="private" i]',
    '.p-channel_sidebar [data-qa="virtual-list-item"][aria-label*="private" i]',
    '.p-channel_sidebar [data-qa="channel-sidebar-channel"][aria-label*="private" i]',
    '.p-channel_sidebar [role="treeitem"]:has([class*="c-icon--lock" i])',
    '.p-channel_sidebar [role="treeitem"]:has([data-qa*="lock" i])',
    '.p-channel_sidebar [data-qa="virtual-list-item"]:has([class*="c-icon--lock" i])',
    '.p-channel_sidebar [data-qa="virtual-list-item"]:has([data-qa*="lock" i])',
    '.p-channel_sidebar [data-qa="channel-sidebar-channel"]:has([class*="c-icon--lock" i])',
    '.p-channel_sidebar [data-qa="channel-sidebar-channel"]:has([data-qa*="lock" i])',
    '.c-channel_entity--private',
  ].join(',');
  var CHANNEL = [
    '.p-channel_sidebar',
    '.p-channel_sidebar__static_list',
    '.p-channel_sidebar__navigation_bar',
    '[data-qa="channel_sidebar"]',
    '[data-qa*="channel_sidebar" i]',
    '[data-qa*="channel-sidebar" i]',
  ].join(',');
  var LOCK_ICON = ['[class*="c-icon--lock" i]', '[data-qa*="lock" i]', '[aria-label*="private channel" i]'].join(',');
  var LOCK_ROW = [
    '[role="treeitem"]',
    '[data-qa="virtual-list-item"]',
    '.c-virtual_list__item',
    '.p-channel_sidebar__channel',
    '[data-qa="channel-sidebar-channel"]',
    '[data-qa*="channel-sidebar-channel" i]',
    '[data-qa="channel_sidebar_channel"]',
    '[data-qa*="channel_sidebar_channel" i]',
  ].join(',');
  var PRIV_NAME = [
    '[data-qa="channel_sidebar_name"]',
    '[data-qa^="channel_sidebar_name_"]',
    '[data-qa*="channel_sidebar_name" i]',
    '[data-qa*="channel_name" i]',
    '.p-channel_sidebar__name',
    '.p-channel_sidebar__name_text',
    '.c-channel_entity__name',
    '[class*="channel_name" i]',
  ].join(',');
  var LOCK_NAME = [
    '[data-qa*="channel_name" i]',
    '[data-qa*="name" i]',
    '[data-qa*="title" i]',
    '[class*="channel_name" i]',
    '[class*="name" i]',
    '[class*="title" i]',
    '[class*="text" i]',
    'span:not([class*="icon" i])',
  ].join(',');
  var DM_CONTAIN = [
    '.p-channel_sidebar__channel--im',
    '[data-qa*="dm_browser" i]',
    '[data-qa*="dm_list" i]',
    '[data-qa*="dm-list" i]',
    '[data-qa*="dms" i]',
    '[class*="dm_browser" i]',
    '[class*="dms" i]',
    '[data-qa*="direct_message" i]',
    '[class*="direct_message" i]',
    '[class*="dm-list" i]',
    '[class*="dm_list" i]',
  ].join(',');
  var DM_USER = [
    '[data-qa="channel_sidebar_name"]',
    '[data-qa^="channel_sidebar_name_"]',
    '[data-qa*="name" i]',
    '.p-channel_sidebar__name',
    '.p-channel_sidebar__name_text',
    '.c-message__sender',
    '[class*="name" i]',
  ].join(',');
  var DM_CONTENT = [
    'time',
    '[data-qa*="timestamp" i]',
    '[data-qa*="preview" i]',
    '[data-qa*="snippet" i]',
    '[data-qa*="last_message" i]',
    '[class*="timestamp" i]',
    '[class*="preview" i]',
    '[class*="snippet" i]',
    '[class*="last_message" i]',
    '.p-channel_sidebar__channel--unread .p-channel_sidebar__badge',
  ].join(',');
  var VIP = ['[aria-label*="vip" i]', '[title*="vip" i]', '[data-qa*="vip" i]'].join(',');
  var VIP_SCOPE = ['.p-profile', '.p-user_profile', '.p-flexpane', '[role="dialog"]', '[data-qa*="profile" i]'].join(
    ',',
  );
  var VIP_RE = /\b(?:non[-\s]?vip|not\s+vip|vip)\b/i;

  function settings() {
    return (window.__slickPluginSettings && window.__slickPluginSettings[DIR]) || {};
  }

  function activationMode() {
    return settings().activation === 'always' ? 'always' : 'screenShare';
  }

  function streamerActive() {
    return activationMode() === 'always' || activeShares.size > 0;
  }

  function rootTargets() {
    var targets = [document.documentElement];
    if (document.body && document.body !== document.documentElement) targets.push(document.body);
    return targets;
  }

  function toggleRootClass(name, enabled) {
    rootTargets().forEach(function (target) {
      target.classList.toggle(name, enabled);
    });
  }

  function applyRootClasses(active) {
    var cfg = settings();
    var dmMode = cfg.dmPreviewBlur || 'all';
    toggleRootClass('slick-streamer-active', active);
    toggleRootClass('slick-streamer-dm-all', dmMode === 'all');
    toggleRootClass('slick-streamer-dm-content', dmMode === 'all' || dmMode === 'content');
    toggleRootClass('slick-streamer-private-channels', cfg.privateChannelNames !== false);
    toggleRootClass('slick-streamer-status', cfg.vipStatus !== false);
  }

  function resetRootClasses(target) {
    ROOT.forEach(function (name) {
      target.classList.remove(name);
    });
  }

  function reportActive(active) {
    if (lastReported === active) return;
    lastReported = active;
    try {
      fetch('https://slick.streamer-mode/status?active=' + (active ? '1' : '0'), {
        mode: 'no-cors',
        cache: 'no-store',
      }).catch(function () {});
    } catch {}
  }

  function setActive(active) {
    currentActive = active;
    applyRootClasses(active);
    reportActive(active);
  }

  function refr() {
    setActive(streamerActive());
  }

  function mark(el, className) {
    if (el && el.nodeType === Node.ELEMENT_NODE) el.classList.add(className || 'slick-streamer-redact');
  }

  function clearMarks(root) {
    root
      .querySelectorAll(
        '.slick-streamer-redact,.slick-streamer-hide,.slick-streamer-avatar,.slick-streamer-private-label,.slick-streamer-private-row',
      )
      .forEach(function (el) {
        el.classList.remove(
          'slick-streamer-redact',
          'slick-streamer-hide',
          'slick-streamer-avatar',
          'slick-streamer-private-label',
          'slick-streamer-private-row',
        );
      });
  }

  function within(root, selector) {
    var found = [];
    if (root.nodeType === Node.ELEMENT_NODE && root.matches(selector)) found.push(root);
    if (root.querySelectorAll) found.push.apply(found, root.querySelectorAll(selector));
    return found;
  }

  function bestTextParent(node) {
    var el = node && node.parentElement;
    var hops = 0;
    while (el && hops < 4) {
      if (el.matches('[role="row"],[role="listitem"],.c-virtual_list__item,[data-qa*="field" i]')) return el;
      el = el.parentElement;
      hops++;
    }
    return node && node.parentElement;
  }

  function markPrivateChannels(root) {
    if (settings().privateChannelNames === false) return;
    within(root, PRIV_CONTAIN).forEach(function (container) {
      var names = container.querySelectorAll(PRIV_NAME);
      if (names.length)
        names.forEach(function (name) {
          mark(name);
        });
      else mark(container);
    });
    within(root, LOCK_ICON).forEach(function (icon) {
      if (!icon.closest(CHANNEL)) return;
      var row = icon.closest(LOCK_ROW);
      if (!row || row.closest('#slick-panel-overlay,#slick-config-backdrop')) return;
      var labels = [];
      row.querySelectorAll(LOCK_NAME).forEach(function (candidate) {
        if (candidate === icon || candidate.contains(icon) || icon.contains(candidate)) return;
        if (candidate.closest('[class*="icon" i],[data-qa*="icon" i]')) return;
        if (!/[A-Za-z0-9][A-Za-z0-9_-]+/.test(candidate.textContent || '')) return;
        labels.push(candidate);
      });
      if (labels.length) {
        labels.forEach(function (label) {
          mark(label, 'slick-streamer-private-label');
        });
      } else {
        mark(row, 'slick-streamer-private-row');
      }
    });
  }

  function markDmPreviews(root) {
    var mode = settings().dmPreviewBlur || 'all';
    within(root, DM_CONTAIN).forEach(function (container) {
      if (mode === 'all') {
        container
          .querySelectorAll('.c-avatar,img,[class*="avatar" i],[data-qa*="avatar" i],[style*="background-image" i]')
          .forEach(function (el) {
            mark(el, 'slick-streamer-avatar');
          });
      }
      container.querySelectorAll(DM_CONTENT).forEach(function (el) {
        mark(el);
      });
      if (mode === 'all') {
        container.querySelectorAll(DM_USER).forEach(function (el) {
          mark(el);
        });
      }
    });
  }

  function markVipStatus(root) {
    if (settings().vipStatus === false) return;
    within(root, VIP).forEach(function (el) {
      mark(el, 'slick-streamer-hide');
    });
    within(root, VIP_SCOPE).forEach(function (scope) {
      var walker = document.createTreeWalker(scope, NodeFilter.SHOW_TEXT, {
        acceptNode: function (node) {
          if (!VIP_RE.test(node.nodeValue || '')) return NodeFilter.FILTER_REJECT;
          if (node.parentElement && node.parentElement.closest('[contenteditable="true"]'))
            return NodeFilter.FILTER_REJECT;
          return NodeFilter.FILTER_ACCEPT;
        },
      });
      var node;
      while ((node = walker.nextNode())) mark(bestTextParent(node), 'slick-streamer-hide');
    });
  }

  function scan(root) {
    var scopes = new Set([root]);
    if (root.nodeType === Node.ELEMENT_NODE) {
      [PRIV_CONTAIN, LOCK_ROW, DM_CONTAIN, VIP_SCOPE].forEach(function (selector) {
        var parent = root.closest(selector);
        if (parent) scopes.add(parent);
      });
    }
    scopes.forEach(function (scope) {
      markPrivateChannels(scope);
      markDmPreviews(scope);
      markVipStatus(scope);
    });
  }

  function scanAll() {
    scanTimer = null;
    clearMarks(document);
    scan(document);
  }

  function ss() {
    if (scanTimer) return;
    scanTimer = setTimeout(scanAll, 50);
  }

  function trackStream(stream) {
    if (!stream || !stream.getTracks) return;
    var token = {};
    activeShares.add(token);
    refr();

    var done = false;
    function finish() {
      if (done) return;
      done = true;
      activeShares.delete(token);
      refr();
    }

    var tracks = stream.getVideoTracks ? stream.getVideoTracks() : stream.getTracks();
    tracks.forEach(function (track) {
      if (!track || track[PATCHED]) return;
      track[PATCHED] = true;
      track.addEventListener('ended', finish, { once: true });
      track.addEventListener('mute', function () {
        if (track.readyState === 'ended') finish();
      });
    });
    stream.addEventListener('inactive', finish, { once: true });
  }

  function patchDisplay() {
    var media = navigator.mediaDevices;
    if (!media || !media.getDisplayMedia || media.getDisplayMedia[PATCHED]) return;
    var original = media.getDisplayMedia.bind(media);
    media.getDisplayMedia = function () {
      return original.apply(media, arguments).then(function (stream) {
        trackStream(stream);
        return stream;
      });
    };
    media.getDisplayMedia[PATCHED] = true;
  }

  function fn() {
    return {
      close: function () {},
      addEventListener: function () {},
      removeEventListener: function () {},
      dispatchEvent: function () {
        return true;
      },
    };
  }

  function pn() {
    var NativeNotification = window.Notification;
    if (!NativeNotification || NativeNotification[PATCHED]) return;

    function SlickNotification(title, options) {
      if (currentActive) return fn();
      return new NativeNotification(title, options);
    }

    try {
      Object.defineProperty(SlickNotification, 'permission', {
        get: function () {
          return NativeNotification.permission;
        },
      });
      SlickNotification.requestPermission = function () {
        return NativeNotification.requestPermission.apply(NativeNotification, arguments);
      };
      SlickNotification.prototype = NativeNotification.prototype;
      SlickNotification[PATCHED] = true;
      window.Notification = SlickNotification;
    } catch {}
  }

  function boot() {
    patchDisplay();
    pn();
    if (document.body) resetRootClasses(document.body);
    refr();
    scan(document);
    var pendingRoots = new Set();
    var rootsTimer = null;
    function queue(root) {
      if (root.nodeType !== Node.ELEMENT_NODE) return;
      for (var pending of pendingRoots) {
        if (pending.contains(root)) return;
        if (root.contains(pending)) pendingRoots.delete(pending);
      }
      pendingRoots.add(root);
    }
    new MutationObserver(function (mutations) {
      mutations.forEach(function (mutation) {
        mutation.addedNodes.forEach(queue);
      });
      if (!pendingRoots.size || rootsTimer) return;
      rootsTimer = setTimeout(function () {
        rootsTimer = null;
        var roots = Array.from(pendingRoots);
        pendingRoots.clear();
        roots.forEach(scan);
      }, 100);
    }).observe(document.documentElement, { childList: true, subtree: true });
    window.addEventListener('slick:plugin-settings', function () {
      refr();
      ss();
    });
  }

  window.__slickStreamerMode = {
    refresh: function () {
      refr();
      ss();
    },
  };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot, { once: true });
  else boot();
})();
