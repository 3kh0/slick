(function () {
  'use strict';
  if (window.__slickCustomNameRecording) return;
  window.__slickCustomNameRecording = true;

  let webpackRequire;

  function audioProps(el) {
    const key = el && Object.keys(el).find((name) => /^__react(Fiber|InternalInstance)\$/.test(name));
    let fiber = key ? el[key] : null;
    let hops = 0;
    while (fiber && hops < 40) {
      for (const props of [fiber.memoizedProps, fiber.pendingProps]) {
        const audio = props && props.audioFileProps;
        if (
          ['onChangeFile', 'onFileUploadStart', 'onFileUploadEnd'].every((name) => typeof audio?.[name] === 'function')
        )
          return audio;
      }
      fiber = fiber.return;
      hops++;
    }
    return null;
  }

  function getWebpackRequire() {
    if (webpackRequire) return webpackRequire;
    const chunks = window.webpackChunkwebapp;
    if (!chunks?.push) throw new Error('module loader is not ready');
    chunks.push([
      ['slick-custom-name-recording-' + Date.now()],
      {},
      (require) => {
        webpackRequire = require;
      },
    ]);
    if (!webpackRequire) throw new Error('coulnt access module loader');
    return webpackRequire;
  }

  const findModule = (require, needle, fallbackId) =>
    require(Object.keys(require.m || {}).find((key) => String(require.m[key]).includes(needle)) || fallbackId);

  function api() {
    const r = getWebpackRequire();
    const uploadAction = Object.values(findModule(r, 'addAndUploadPendingFile', 0x35cd0c41)).find(
      (value) => typeof value === 'function' && value.meta?.name === 'addAndUploadPendingFile',
    );
    const getStores = Object.values(findModule(r, 'getStoreInstanceMap', 0x1856bb20b)).find(
      (value) => typeof value === 'function' && value.name === 'getStoreInstanceMap',
    );
    if (!uploadAction || !getStores) throw new Error('upload internals changed');
    return { uploadAction, getStores };
  }

  function current(getStores) {
    const stores = getStores() || {};
    const routeTeamId = location.pathname.match(/\/client\/([A-Z0-9]+)/)?.[1];
    if (routeTeamId && stores[routeTeamId]) return stores[routeTeamId];

    const list = Object.values(stores).filter(
      (store) => typeof store?.dispatch === 'function' && typeof store?.getState === 'function',
    );
    const match = list.find((store) => store.getState()?.selfTeamIds?.teamId === routeTeamId);
    if (match || list.length === 1) return match || list[0];
    throw new Error('couldnt determine workspace');
  }

  function duration(file) {
    return new Promise((resolve, reject) => {
      const audio = document.createElement('audio');
      const url = URL.createObjectURL(file);
      const timer = setTimeout(() => done(new Error('timed out reading audio')), 10000);
      const done = (error) => {
        clearTimeout(timer);
        audio.removeAttribute('src');
        audio.load();
        URL.revokeObjectURL(url);
        error ? reject(error) : resolve(audio.duration);
      };
      audio.preload = 'metadata';
      audio.addEventListener('loadedmetadata', () => done(), { once: true });
      audio.addEventListener('error', () => done(new Error('cant read audio')), { once: true });
      audio.src = url;
    });
  }

  async function data(file) {
    const AudioContext = window.AudioContext || window.webkitAudioContext;
    if (!AudioContext) return { duration: await duration(file) };

    const ctx = new AudioContext();
    try {
      const b = await ctx.decodeAudioData(await file.arrayBuffer());
      const c = b.getChannelData(0);
      const sc = Math.min(100, Math.max(20, Math.round(b.duration * 5)));
      const s = Math.max(1, Math.floor(c.length / sc));
      const amp = Array.from({ length: sc }, (_, i) => {
        const start = i * s;
        const end = Math.min(c.length, start + s);
        let peak = 0;
        for (let j = start; j < end; j++) peak = Math.max(peak, Math.abs(c[j]));
        return Math.round(peak * 100);
      });
      return { duration: b.duration, audio_wave_samples: amp };
    } catch {
      return { duration: await duration(file) };
    } finally {
      ctx.close().catch(() => {});
    }
  }

  async function prep(src) {
    const file = Object.assign(
      new File([src], 'audio_name_pronunciation.mp3', {
        type: src.type || 'audio/mpeg',
        lastModified: src.lastModified,
      }),
      { subtype: 'slack_name_pronunciation', ...(await data(src)) },
    );
    if (!Number.isFinite(file.duration)) throw new Error('cant read duration');
    return file;
  }

  function setError(field, msg) {
    let error = field.querySelector('.slick-cnr-error');
    if (!msg) return error?.remove();
    if (!error) {
      error = document.createElement('div');
      error.className = 'slick-cnr-error c-inline_alert c-inline_alert--level_error margin_top_50';
      error.setAttribute('role', 'alert');
      field.appendChild(error);
    }
    error.textContent = msg;
  }

  function rej(error) {
    const detail = [error?.data?.error, error?.error, error?.reason, error?.message].find(
      (value) => typeof value === 'string' && value,
    );
    return detail
      ? `Slack rejected the upload: ${detail.replaceAll('_', ' ')}`
      : 'Slack rejected the upload. Try a shorter MP3.';
  }

  function setState(button, label, busy) {
    const text = button.querySelector('.margin_left_25');
    if (text) text.textContent = label;
    button.setAttribute('aria-label', label);
    button.disabled = busy;
    button.setAttribute('aria-busy', String(busy));
  }

  function pick() {
    return new Promise((resolve) => {
      const input = document.createElement('input');
      Object.assign(input, { type: 'file', accept: 'audio/mpeg,.mp3', hidden: true });
      const done = (file) => {
        resolve(file);
        input.remove();
      };
      input.addEventListener('change', () => done(input.files?.[0] || null), { once: true });
      input.addEventListener('cancel', () => done(null), { once: true });
      document.body.appendChild(input);
      input.click();
    });
  }

  async function upf(file) {
    const { uploadAction, getStores } = api();
    let res;
    try {
      const pending = await current(getStores).dispatch(
        uploadAction({
          file,
          hideBanner: true,
          traceTags: { subtype: file.subtype, source: 'slick_custom_name_recording' },
        }),
      );
      res = await pending?.uploadPromise;
    } catch (error) {
      throw new Error(rej(error), { cause: error });
    }
    const id = res?.fileIds?.[0];
    if (!id) throw new Error(rej(res));
    return id;
  }

  async function upload(button) {
    const field = button.closest('.p-edit_profile__audio_recorder_component');
    const props = audioProps(field?.querySelector('.p-edit_profile__audio_recorder_icon:not([data-slick-cnr-upload])'));
    if (!props) throw new Error('Could not connect to the profile form');

    const src = await pick();
    if (!src) return;
    if (!src.name.toLowerCase().endsWith('.mp3') && src.type !== 'audio/mpeg') {
      throw new Error('Choose an MP3 file');
    }

    setError(field, '');
    setState(button, 'Checking audio...', true);
    let uploadStarted = false;
    try {
      const file = await prep(src);
      if (file.duration > 10)
        throw new Error(`Audio must be 10 seconds or shorter. This clip is ${file.duration.toFixed(1)} seconds.`);
      setState(button, 'Uploading...', true);
      props.onFileUploadStart();
      uploadStarted = true;
      props.onChangeFile(await upf(file));
    } finally {
      if (uploadStarted) props.onFileUploadEnd();
      const liveButton = field?.querySelector('[data-slick-cnr-upload]');
      if (liveButton) setState(liveButton, 'Upload custom audio', false);
    }
  }

  function cb(rb) {
    const button = rb.cloneNode(true);
    button.dataset.slickCnrUpload = '1';
    delete button.dataset.slickCnrPatched;
    button.classList.replace('slick-cnr-record-button', 'slick-cnr-upload-button');
    button.innerHTML =
      '<svg width="18" height="18" viewBox="0 0 20 20" aria-hidden="true" focusable="false"><path fill="currentColor" fill-rule="evenodd" d="M9.47 2.47a.75.75 0 0 1 1.06 0l3.25 3.25a.75.75 0 1 1-1.06 1.06L10.75 4.81v7.44a.75.75 0 0 1-1.5 0V4.81L7.28 6.78a.75.75 0 0 1-1.06-1.06zM3.75 11a.75.75 0 0 1 .75.75v3.75h11v-3.75a.75.75 0 0 1 1.5 0v4.5a.75.75 0 0 1-.75.75H3.75a.75.75 0 0 1-.75-.75v-4.5a.75.75 0 0 1 .75-.75" clip-rule="evenodd"/></svg><span class="margin_left_25"></span>';
    setState(button, 'Upload custom audio', false);
    return button;
  }

  function pb(rb) {
    rb.dataset.slickCnrPatched = '1';
    rb.classList.add('slick-cnr-record-button');
    const field = rb.closest('.p-edit_profile__audio_recorder_component');
    if (!field) return;
    const uploadButton = field.querySelector('[data-slick-cnr-upload]') || cb(rb);
    if (rb.nextElementSibling !== uploadButton) rb.after(uploadButton);
  }

  function pa() {
    document.querySelectorAll('.p-edit_profile__audio_recorder_icon:not([data-slick-cnr-upload])').forEach(pb);
    document.querySelectorAll('.p-edit_profile__audio_recorder_component').forEach((field) => {
      const button = field.querySelector('[data-slick-cnr-upload]');
      if (button) button.hidden = !!field.querySelector('.p-audio_file, .p-audio_file__pending_file');
    });
  }

  document.addEventListener(
    'click',
    (event) => {
      const button = event.target.closest?.('[data-slick-cnr-upload]');
      if (!button || button.disabled) return;
      const field = button.closest('.p-edit_profile__audio_recorder_component');
      event.preventDefault();
      event.stopImmediatePropagation();
      upload(button).catch((error) => {
        if (field) setError(field, error?.message || 'Could not upload this MP3');
      });
    },
    true,
  );

  function boot() {
    if (!document.body) return setTimeout(boot, 200);
    pa();
    let timer;
    new MutationObserver(() => {
      if (!timer)
        timer = setTimeout(() => {
          timer = null;
          pa();
        }, 100);
    }).observe(document.body, { childList: true, subtree: true });
  }
  boot();
})();
