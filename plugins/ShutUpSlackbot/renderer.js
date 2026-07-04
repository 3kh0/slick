(function () {
  'use strict';

  if (window.__slickShutUpSlackbot) return;

  var PATCHED = '__slickShutUpSlackbotPatched';
  var recent = [];
  var marked = new Set();
  var muteUntil = 0;
  var NativeNotification = window.Notification;
  var NativeAudio = window.Audio;
  var nativePlay = HTMLMediaElement.prototype.play;
  var nativeShowNotification =
    typeof ServiceWorkerRegistration !== 'undefined' && ServiceWorkerRegistration.prototype.showNotification;

  function now() {
    return Date.now();
  }

  function clean() {
    var cutoff = now() - 15000;
    recent = recent.filter(function (hit) {
      return hit.at > cutoff;
    });
    if (marked.size > 300) marked = new Set(Array.from(marked).slice(-150));
  }

  function decode(text) {
    text = String(text == null ? '' : text);
    try {
      var ta = document.createElement('textarea');
      ta.innerHTML = text;
      text = ta.value;
    } catch {}
    return text.replace(/<([^>|]+)\|([^>]+)>/g, '$2').replace(/<([^>]+)>/g, '$1');
  }

  function textOf(message) {
    if (!message || typeof message !== 'object') return '';
    var parts = [message.text, message.message, message.fallback, message.title, message.body];
    if (Array.isArray(message.attachments)) {
      message.attachments.forEach(function (attachment) {
        if (!attachment || typeof attachment !== 'object') return;
        parts.push(attachment.text, attachment.fallback, attachment.pretext, attachment.title);
      });
    }
    if (Array.isArray(message.blocks)) {
      message.blocks.forEach(function (block) {
        if (!block || typeof block !== 'object') return;
        parts.push(block.text && block.text.text);
        if (Array.isArray(block.elements)) {
          block.elements.forEach(function (element) {
            parts.push(element && element.text);
          });
        }
      });
    }
    return decode(parts.filter(Boolean).join(' '));
  }

  function isSlackbot(message) {
    if (!message || typeof message !== 'object') return false;
    var user = message.user || message.user_id || message.bot_id || message.sender || '';
    var name =
      message.username || message.bot_profile?.name || message.bot_profile?.app_name || message.display_name || '';
    return user === 'USLACKBOT' || user === 'USLACK' || /(^|\s)slackbot(\s|$)/i.test(String(name));
  }

  function isSlashCommandNotice(message) {
    var text = textOf(message);
    if (!text) return false;
    var x = /slash[-_\s]+commands?/i.test(text);
    var y = /(^|\s)`?\/[a-z0-9_-]+`?/i.test(text) && /\b(has been using|same command|when people enter)\b/i.test(text);
    return (x || y) && /\b(new|added|created|registered|registration|installed|enabled|configured)\b/i.test(text);
  }

  function token() {
    try {
      var boot = window.boot_data || (window.TS && window.TS.boot_data);
      if (typeof boot?.api_token === 'string' && boot.api_token) return boot.api_token;
    } catch {}
    try {
      var cfg = JSON.parse(localStorage.getItem('localConfig_v2'));
      var teams = (cfg && cfg.teams) || {};
      var routeTeamId = (location.pathname.match(/\/client\/([A-Z0-9]+)/) || [])[1];
      var active = cfg.lastActiveTeamId || routeTeamId;
      if (active && teams[active]?.token) return teams[active].token;
      for (var id in teams) if (teams[id]?.token) return teams[id].token;
    } catch {}
    return null;
  }

  function markRead(channel, ts) {
    if (!channel || !ts) return;
    var key = channel + ':' + ts;
    if (marked.has(key)) return;
    marked.add(key);

    var tk = token();
    if (!tk) return;
    var body = new FormData();
    body.set('token', tk);
    body.set('channel', channel);
    body.set('ts', ts);

    fetch('/api/conversations.mark', { method: 'POST', body: body, credentials: 'include' })
      .then(function (res) {
        if (res.ok || String(channel).charAt(0) !== 'D') return null;
        var fallback = new FormData();
        fallback.set('token', tk);
        fallback.set('channel', channel);
        fallback.set('ts', ts);
        return fetch('/api/im.mark', { method: 'POST', body: fallback, credentials: 'include' }).catch(function () {});
      })
      .catch(function () {});
  }

  function record(message, fallbackChannel) {
    if (!isSlackbot(message) || !isSlashCommandNotice(message)) return false;
    var channel = message.channel || message.channel_id || message.channelId || fallbackChannel || '';
    var ts = message.ts || message.event_ts || message.message_ts || '';
    recent.push({ at: now(), channel: channel, ts: ts, text: textOf(message) });
    muteUntil = now() + 15000;
    clean();
    markRead(channel, ts);
    return true;
  }

  function nmsg(value) {
    if (!value || typeof value !== 'object' || value.type !== 'desktop_notification') return null;
    return {
      user: value.sender_id || value.user || '',
      username: value.subtitle || value.title || '',
      text: [value.content, value.title, value.subtitle].filter(Boolean).join(' '),
      channel: value.channel,
      ts: value.msg || value.ts || value.event_ts,
    };
  }

  function suppressSocket(value) {
    var message = nmsg(value);
    return !!message && record(message, message.channel);
  }

  function visit(value, depth, fallbackChannel) {
    if (!value || depth > 8) return;
    if (typeof value === 'string') {
      var trimmed = value.trim();
      if (trimmed[0] === '{' || trimmed[0] === '[') {
        try {
          visit(JSON.parse(trimmed), depth + 1, fallbackChannel);
        } catch {}
      }
      return;
    }
    if (Array.isArray(value)) {
      value.forEach(function (item) {
        visit(item, depth + 1, fallbackChannel);
      });
      return;
    }
    if (typeof value !== 'object') return;

    var channel = value.channel || value.channel_id || fallbackChannel || '';
    if (value.type === 'message' || value.message || value.event) {
      record(value.message || value.event || value, channel);
    }
    Object.keys(value).forEach(function (key) {
      if (value[key] && typeof value[key] === 'object') visit(value[key], depth + 1, channel);
    });
  }

  function parseSocketData(data) {
    if (typeof data !== 'string') return null;

    try {
      return JSON.parse(data);
    } catch {
      return null;
    }
  }

  function onSocket(event) {
    var data = event && event.data;
    if (typeof Blob !== 'undefined' && data instanceof Blob) {
      data
        .text()
        .then(function (text) {
          var parsed = parseSocketData(text);
          if (parsed) visit(parsed, 0, '');
        })
        .catch(function () {});
      return;
    }
    if (typeof ArrayBuffer !== 'undefined' && data instanceof ArrayBuffer) {
      try {
        data = new TextDecoder().decode(data);
      } catch {}
    }
    var parsed = parseSocketData(data);
    if (parsed) {
      visit(parsed, 0, '');
      if (suppressSocket(parsed)) {
        try {
          event.stopImmediatePropagation();
          event.preventDefault();
        } catch {}
      }
    }
  }

  function patchSocket() {
    var Native = window.WebSocket;
    if (!Native || Native[PATCHED]) return;
    var armed = new WeakSet();
    var nativeAdd = Native.prototype.addEventListener;

    function arm(socket) {
      if (!socket || armed.has(socket)) return;
      armed.add(socket);
      try {
        nativeAdd.call(socket, 'message', onSocket, true);
      } catch {}
    }

    function SlickWebSocket(url, protocols) {
      var socket = protocols === undefined ? new Native(url) : new Native(url, protocols);
      arm(socket);
      return socket;
    }

    try {
      Object.setPrototypeOf(SlickWebSocket, Native);
    } catch {}
    SlickWebSocket.prototype = Native.prototype;
    ['CONNECTING', 'OPEN', 'CLOSING', 'CLOSED'].forEach(function (key) {
      try {
        Object.defineProperty(SlickWebSocket, key, { value: Native[key] });
      } catch {}
    });

    Native.prototype.addEventListener = function (type) {
      if (type === 'message') arm(this);
      return nativeAdd.apply(this, arguments);
    };

    SlickWebSocket[PATCHED] = true;
    window.WebSocket = SlickWebSocket;
  }

  function fakeNotification() {
    return {
      close: function () {},
      addEventListener: function () {},
      removeEventListener: function () {},
      dispatchEvent: function () {
        return true;
      },
    };
  }

  function shouldSuppressNotification(title, options) {
    clean();
    var body = options && (options.body || options.subtitle || options.message || '');
    var text = decode(String(title || '') + ' ' + String(body || ''));
    if (isSlashCommandNotice({ text: text, user: 'USLACKBOT' })) return true;
    return recent.length > 0 && now() < muteUntil && /slackbot|slash[-_\s]+command/i.test(text);
  }

  function patchNotification() {
    if (!NativeNotification || NativeNotification[PATCHED]) return;
    function SlickNotification(title, options) {
      if (shouldSuppressNotification(title, options)) return fakeNotification();
      return new NativeNotification(title, options);
    }
    try {
      Object.setPrototypeOf(SlickNotification, NativeNotification);
    } catch {}
    SlickNotification.prototype = NativeNotification.prototype;
    Object.defineProperty(SlickNotification, 'permission', {
      get: function () {
        return NativeNotification.permission;
      },
    });
    SlickNotification.requestPermission = function () {
      return NativeNotification.requestPermission.apply(NativeNotification, arguments);
    };
    Object.defineProperty(SlickNotification, PATCHED, { value: true });
    window.Notification = SlickNotification;
  }

  function patchNotify() {
    if (!nativeShowNotification || nativeShowNotification[PATCHED]) return;
    ServiceWorkerRegistration.prototype.showNotification = function (title, options) {
      if (shouldSuppressNotification(title, options)) return Promise.resolve();
      return nativeShowNotification.apply(this, arguments);
    };
    Object.defineProperty(ServiceWorkerRegistration.prototype.showNotification, PATCHED, { value: true });
  }

  function shouldMuteSound(src) {
    clean();
    if (!recent.length || now() >= muteUntil) return false;
    if (!src) return true;
    return /sound|notification|notify|mention|alert|ding|knock|chime|beep|incoming|slack/i.test(String(src));
  }

  function patchAudio() {
    if (NativeAudio && !NativeAudio[PATCHED]) {
      function SlickAudio(src) {
        var audio = src === undefined ? new NativeAudio() : new NativeAudio(src);
        if (shouldMuteSound(src)) {
          audio.muted = true;
          audio.volume = 0;
        }
        return audio;
      }
      try {
        Object.setPrototypeOf(SlickAudio, NativeAudio);
      } catch {}
      SlickAudio.prototype = NativeAudio.prototype;
      Object.defineProperty(SlickAudio, PATCHED, { value: true });
      window.Audio = SlickAudio;
    }
    if (!nativePlay[PATCHED]) {
      HTMLMediaElement.prototype.play = function () {
        var src = this.currentSrc || this.src || '';
        if (shouldMuteSound(src)) {
          try {
            this.dataset.slickShutUpSlackbotMuted = 'true';
            this.muted = true;
            this.volume = 0;
          } catch {}
          return Promise.resolve();
        }
        return nativePlay.apply(this, arguments);
      };
      Object.defineProperty(HTMLMediaElement.prototype.play, PATCHED, { value: true });
    }
  }

  window.__slickShutUpSlackbot = {
    test: function (message) {
      record(message || {}, '');
      return { recent: recent.slice(), muted: now() < muteUntil };
    },
  };

  patchSocket();
  patchNotification();
  patchNotify();
  patchAudio();
})();
