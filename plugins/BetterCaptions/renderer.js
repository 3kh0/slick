(() => {
  if (window.__slickBetterCaptions) return;
  window.__slickBetterCaptions = true;

  let stream;
  let recorder;
  let timer;
  let busy = false;
  let segments = [];
  let captureId = 0;
  let pendingCleanup;

  const root = document.createElement('section');
  root.id = 'slick-better-captions';
  root.innerHTML =
    '<div class="slick-bc-text">BetterCaptions is ready</div><button type="button">Start captions</button>';
  Object.assign(root.style, {
    position: 'fixed',
    left: '50%',
    bottom: '28px',
    transform: 'translateX(-50%)',
    zIndex: '100000',
    maxWidth: 'min(760px, calc(100vw - 32px))',
    padding: '10px 14px',
    borderRadius: '10px',
    background: 'rgba(20,20,24,.92)',
    color: '#fff',
    boxShadow: '0 4px 24px rgba(0,0,0,.35)',
    display: 'flex',
    gap: '12px',
    alignItems: 'center',
    font: '14px/1.4 Slack-Lato, sans-serif',
  });
  const text = root.querySelector('.slick-bc-text');
  const button = root.querySelector('button');
  Object.assign(button.style, { whiteSpace: 'nowrap', cursor: 'pointer' });

  function settings() {
    return window.__slickPluginSettings?.BetterCaptions || {};
  }
  function status(value) {
    text.textContent = value;
  }

  function processSegments() {
    if (busy) return;
    while (segments.length && segments[0].id !== captureId) segments.shift();
    const segment = segments.shift();
    if (!segment) return;
    busy = true;
    const requestId = crypto.randomUUID();
    let resultTimer;
    let done = false;
    const cleanup = () => {
      if (done) return;
      done = true;
      window.removeEventListener('slick:better-captions-result', receive);
      clearTimeout(resultTimer);
      if (pendingCleanup === cleanup) pendingCleanup = null;
      busy = false;
      processSegments();
    };
    const receive = (event) => {
      if (event.detail?.id !== requestId) return;
      cleanup();
      if (segment.id !== captureId) return;
      if (event.detail.error) status(`BetterCaptions: ${event.detail.error}`);
      else if (event.detail.text) status(event.detail.text);
    };
    window.addEventListener('slick:better-captions-result', receive);
    pendingCleanup = cleanup;
    resultTimer = setTimeout(() => {
      cleanup();
      if (segment.id === captureId) status('BetterCaptions: Transcription timed out.');
    }, 30000);
    fetch(`https://slick.better-captions/transcribe?id=${encodeURIComponent(requestId)}`, {
      method: 'POST',
      body: segment.blob,
    }).catch(() => {});
  }

  function submit(blob, id) {
    if (!blob.size || id !== captureId) return;
    segments.push({ blob, id });
    processSegments();
  }

  function recordSegment(id) {
    if (!stream?.active || id !== captureId) return;
    const chunks = [];
    const activeRecorder = new MediaRecorder(stream, {
      mimeType: MediaRecorder.isTypeSupported('audio/webm;codecs=opus') ? 'audio/webm;codecs=opus' : 'audio/webm',
    });
    const mimeType = activeRecorder.mimeType;
    recorder = activeRecorder;
    activeRecorder.ondataavailable = (event) => {
      if (event.data.size) chunks.push(event.data);
    };
    activeRecorder.onstop = () => submit(new Blob(chunks, { type: mimeType }), id);
    activeRecorder.start();
    timer = setTimeout(
      () => {
        if (activeRecorder.state === 'recording') activeRecorder.stop();
        recordSegment(id);
      },
      Math.max(3, Number(settings().segmentSeconds) || 5) * 1000,
    );
  }

  function stop() {
    const activeRecorder = recorder;
    captureId++;
    segments = [];
    clearTimeout(timer);
    pendingCleanup?.();
    if (activeRecorder?.state === 'recording') activeRecorder.stop();
    stream?.getTracks().forEach((track) => track.stop());
    stream = recorder = null;
    button.textContent = 'Start captions';
    status('Captions stopped');
  }

  async function start() {
    try {
      await fetch('https://slick.better-captions/capture', { method: 'POST' }).catch(() => {});
      stream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: true });
      stream.getVideoTracks().forEach((track) => track.stop());
      if (!stream.getAudioTracks().length) throw new Error('Share a window or screen with system audio enabled.');
      const id = ++captureId;
      stream.getAudioTracks()[0].addEventListener('ended', () => id === captureId && stop(), { once: true });
      button.textContent = 'Stop captions';
      status('Listening…');
      recordSegment(id);
    } catch (error) {
      stop();
      const message =
        error.name === 'NotSupportedError' ? 'Restart Slick to activate system-audio capture.' : error.message;
      status(`BetterCaptions: ${message}`);
    }
  }

  button.addEventListener('click', () => (stream ? stop() : start()));
  function mount() {
    if (document.body && !root.isConnected) document.body.appendChild(root);
  }
  mount();
  document.addEventListener('DOMContentLoaded', mount, { once: true });
})();
