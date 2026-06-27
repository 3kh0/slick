(function () {
  'use strict';
  if (window.__slickCustomSounds) return;

  const NativeAudio = window.Audio;
  const NativeNotification = window.Notification;
  const play = HTMLMediaElement.prototype.play;
  const hint = /sound|notification|notify|mention|alert|ding|knock|chime|beep|incoming|slack/i;

  const cfg = () => window.__slickPluginSettings?.CustomSounds || {};
  const path = () => String(cfg().soundPath || '').trim();
  const on = () => cfg().enabled !== false && !!path();
  const url = () =>
    'slick-custom-sounds://current/sound' +
    (path().match(/\.[a-z0-9]{1,8}$/i)?.[0] || '.mp3') +
    '?p=' +
    encodeURIComponent(path());

  function replace(a) {
    const src = a?.currentSrc || a?.src || a?.querySelector?.('source[src]')?.src || '';
    if (!on() || !src || src.startsWith('slick-custom-sounds:') || src.startsWith('blob:') || src.startsWith('data:'))
      return;
    let u;
    try {
      u = new URL(src, location.href);
    } catch {
      return;
    }
    if (/\.(aac|aif|aiff|caf|flac|m4a|mp3|oga|ogg|opus|wav|webm)(?:$|[?#])/i.test(u.pathname) || hint.test(src)) {
      a.dataset.slickCustomSoundsOriginal ||= src;
      a.src = url();
    }
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
