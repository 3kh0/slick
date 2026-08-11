(function () {
  'use strict';
  if (window.__slickCustomSounds) return;

  const NativeAudio = window.Audio;
  const NativeNotification = window.Notification;
  const play = HTMLMediaElement.prototype.play;

  const SOUNDS = new Set([
    'animal_stick',
    'b2',
    'been_tree',
    'boop',
    'channel_message',
    'channel_message_2x',
    'complete_quest_requirement',
    'confirm_delivery',
    'flitterbug',
    'here_you_go_lighter',
    'hi_flowers_hit',
    'hummus',
    'item_pickup',
    'knock_brush',
    'save_and_checkout',
  ]);

  const asset = /^([a-z0-9_]+?)(?:-[0-9a-f]{6,32})?\.(?:aac|m4a|mp3|oga|ogg|opus|wav)$/i;

  const cfg = () => window.__slickPluginSettings?.CustomSounds || {};
  const path = () => String(cfg().soundPath || '').trim();
  const on = () => cfg().enabled !== false && !!path();
  const url = () =>
    'slick-custom-sounds://current/sound' +
    (path().match(/\.[a-z0-9]{1,8}$/i)?.[0] || '.mp3') +
    '?p=' +
    encodeURIComponent(path());

  function isNotificationSound(src) {
    let u;
    try {
      u = new URL(src, location.href);
    } catch {
      return false;
    }
    if (u.protocol !== 'https:' && u.protocol !== 'http:') return false;
    if (!/(^|\.)slack-edge\.com$/i.test(u.hostname) && u.origin !== location.origin) return false;
    const name = u.pathname.slice(u.pathname.lastIndexOf('/') + 1).match(asset)?.[1];
    return !!name && SOUNDS.has(name.toLowerCase());
  }

  function replace(a) {
    if (!a || a.tagName !== 'AUDIO') return;
    const original = a.dataset.slickCustomSoundsOriginal;
    if (original) {
      const next = on() ? url() : original;
      if (a.src !== next) a.src = next;
      return;
    }
    if (!on()) return;
    const src = a.currentSrc || a.src || a.querySelector?.('source[src]')?.src || '';
    if (!src || !isNotificationSound(src)) return;
    a.dataset.slickCustomSoundsOriginal = src;
    a.src = url();
  }

  function SlickAudio(src) {
    const a = src === undefined ? new NativeAudio() : new NativeAudio(src);
    replace(a);
    return a;
  }
  Object.setPrototypeOf(SlickAudio, NativeAudio);
  SlickAudio.prototype = NativeAudio.prototype;
  window.Audio = SlickAudio;
  HTMLMediaElement.prototype.play = function () {
    replace(this);
    return play.apply(this, arguments);
  };

  function playCustom() {
    if (!on()) return;
    try {
      new NativeAudio(url()).play().catch(() => {});
    } catch {}
  }

  if (NativeNotification && !NativeNotification.__slickCustomSoundsPatched) {
    function SlickNotification(title, options) {
      const n = new NativeNotification(title, on() ? { ...options, silent: true } : options);
      playCustom();
      return n;
    }
    Object.setPrototypeOf(SlickNotification, NativeNotification);
    SlickNotification.prototype = NativeNotification.prototype;
    Object.defineProperty(SlickNotification, 'permission', { get: () => NativeNotification.permission });
    SlickNotification.requestPermission = (...a) => NativeNotification.requestPermission(...a);
    Object.defineProperty(SlickNotification, '__slickCustomSoundsPatched', { value: true });
    window.Notification = SlickNotification;
  }

  window.__slickCustomSounds = {
    enabled: on,
    playCustomSound: playCustom,
    soundUrl: url,
    isNotificationSound,
    test: () =>
      new Promise((resolve) => {
        const a = new NativeAudio(url());
        const done = (ok, reason) => {
          a.removeAttribute('src');
          a.load();
          resolve({ ok, reason, url: url() });
        };
        a.addEventListener('loadedmetadata', () => done(true, 'loadedmetadata'), { once: true });
        a.addEventListener('error', () => done(false, 'error'), { once: true });
        a.load();
      }),
  };
})();
