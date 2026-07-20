'use strict';

const fs = require('fs');
const path = require('path');

const ALLOWED_HOSTS = new Set(['api.openai.com', 'api.x.ai']);
const PROVIDER_TIMEOUT_MS = 12000;

module.exports = {
  meta: {
    name: 'BetterCaptions',
    description: 'Live captions for Slack calls using a Whisper-compatible transcription API.',
  },
  settings: {
    provider: {
      type: 'select',
      label: 'Provider',
      description: 'The transcription API to use.',
      default: 'openai',
      options: [
        { value: 'openai', label: 'OpenAI' },
        { value: 'xai', label: 'xAI' },
        { value: 'custom', label: 'Custom endpoint' },
      ],
      restartRequired: true,
    },
    apiKey: {
      type: 'text',
      label: 'API key',
      description: 'Stored locally in Slick settings and sent only to the selected provider.',
      default: '',
      restartRequired: true,
    },
    endpoint: {
      type: 'text',
      label: 'Custom endpoint',
      description: 'HTTPS Whisper-compatible /audio/transcriptions endpoint (custom provider only).',
      default: '',
      restartRequired: true,
    },
    model: {
      type: 'text',
      label: 'Model',
      description: 'Transcription model name.',
      default: 'whisper-1',
      restartRequired: true,
    },
    language: {
      type: 'text',
      label: 'Language',
      description: 'Optional ISO-639-1 language code; leave blank for auto-detection.',
      default: '',
      restartRequired: true,
    },
    mode: {
      type: 'select',
      label: 'Caption mode',
      description: 'Optionally transform each completed caption.',
      default: 'normal',
      options: [
        { value: 'normal', label: 'Normal' },
        { value: 'australian', label: 'Australian (invert meaning)' },
      ],
      restartRequired: true,
    },
    transformModel: {
      type: 'text',
      label: 'Caption transform model',
      description: 'Text model used by fun modes (for example, gpt-4o-mini or grok-3-mini).',
      default: 'gpt-4o-mini',
      restartRequired: true,
    },
    segmentSeconds: {
      type: 'number',
      label: 'Caption interval',
      description: 'Seconds of audio per transcription request (minimum 3).',
      default: 5,
    },
  },
  renderer: fs.readFileSync(path.join(__dirname, 'renderer.js'), 'utf8'),
  main(ctx) {
    const sessions = new Map();
    let disarmTimer;

    const retainSession = (session) => sessions.set(session, (sessions.get(session) || 0) + 1);
    const releaseSession = (session) => {
      const references = sessions.get(session) || 0;
      if (references <= 1) sessions.delete(session);
      else sessions.set(session, references - 1);
    };

    const disarmCapture = () => {
      clearTimeout(disarmTimer);
      for (const session of sessions.keys()) {
        try {
          session.setDisplayMediaRequestHandler(null);
        } catch {}
      }
    };

    const armCapture = () => {
      if (process.platform !== 'win32') throw new Error('System-audio capture is currently supported on Windows only.');
      disarmCapture();
      const handler = async (request, callback) => {
        let called = false;
        const reply = (streams) => {
          if (called) return;
          called = true;
          callback(streams);
        };
        try {
          let hostname = '';
          try {
            hostname = new URL(request.securityOrigin).hostname.toLowerCase();
          } catch {}
          const slackOrigin = ['slack.com', 'slack-edge.com', 'slackb.com'].some(
            (base) => hostname === base || hostname.endsWith(`.${base}`),
          );
          if (!request.audioRequested || !request.videoRequested || !slackOrigin)
            throw new Error(`Rejected display capture request from ${hostname || 'unknown origin'}.`);
          const sources = await ctx.electron.desktopCapturer.getSources({
            types: ['screen'],
            thumbnailSize: { width: 0, height: 0 },
          });
          if (!sources[0]) throw new Error('No screen is available for audio capture.');
          reply({ video: sources[0], audio: 'loopback' });
        } catch (error) {
          ctx.log('capture error:', error.message);
          if (!called) reply({});
        } finally {
          setTimeout(disarmCapture, 0);
        }
      };
      for (const session of sessions.keys()) session.setDisplayMediaRequestHandler(handler);
      disarmTimer = setTimeout(disarmCapture, 10000);
    };

    ctx.onWindow((win) => {
      const session = win.webContents.session;
      retainSession(session);
      win.webContents.once('destroyed', () => releaseSession(session));
    });

    const transcribe = async (audio) => {
      const settings = ctx.settings || {};
      const key = String(settings.apiKey || '').trim();
      if (!key) throw new Error('Add an API key in BetterCaptions settings.');

      let endpoint;
      if (settings.provider === 'xai') endpoint = 'https://api.x.ai/v1/audio/transcriptions';
      else if (settings.provider === 'custom') endpoint = String(settings.endpoint || '').trim();
      else endpoint = 'https://api.openai.com/v1/audio/transcriptions';

      const target = new URL(endpoint);
      if (target.protocol !== 'https:') throw new Error('The endpoint must use HTTPS.');
      if (settings.provider !== 'custom' && !ALLOWED_HOSTS.has(target.hostname))
        throw new Error('Invalid provider endpoint.');

      if (!audio || !audio.size) throw new Error('No audio was captured.');

      const body = new FormData();
      body.append('file', audio, 'caption.webm');
      body.append('model', String(settings.model || 'whisper-1'));
      if (String(settings.language || '').trim()) body.append('language', String(settings.language).trim());
      body.append('response_format', 'json');

      const transcriptionController = new AbortController();
      const transcriptionTimer = setTimeout(() => transcriptionController.abort(), PROVIDER_TIMEOUT_MS);
      let result;
      try {
        result = await fetch(target, {
          method: 'POST',
          headers: { Authorization: `Bearer ${key}` },
          body,
          signal: transcriptionController.signal,
        });
      } catch (error) {
        if (error.name === 'AbortError') throw new Error('Transcription provider timed out.', { cause: error });
        throw error;
      } finally {
        clearTimeout(transcriptionTimer);
      }
      const payload = await result.json().catch(() => ({}));
      if (!result.ok) throw new Error(payload.error?.message || `Transcription failed (${result.status}).`);

      let text = String(payload.text || '').trim();
      if (text && settings.mode === 'australian') {
        if (settings.provider === 'custom') {
          throw new Error('Australian mode is available with the OpenAI and xAI providers.');
        }
        const chatEndpoint =
          settings.provider === 'xai'
            ? 'https://api.x.ai/v1/chat/completions'
            : 'https://api.openai.com/v1/chat/completions';
        const transformController = new AbortController();
        const transformTimer = setTimeout(() => transformController.abort(), PROVIDER_TIMEOUT_MS);
        let transformed;
        try {
          transformed = await fetch(chatEndpoint, {
            method: 'POST',
            headers: { Authorization: `Bearer ${key}`, 'content-type': 'application/json' },
            body: JSON.stringify({
              model: String(settings.transformModel || (settings.provider === 'xai' ? 'grok-3-mini' : 'gpt-4o-mini')),
              messages: [
                {
                  role: 'user',
                  content: `Invert the meaning of this caption while preserving its language and concise tone. Return only the inverted caption:\n\n${text}`,
                },
              ],
              temperature: 0.2,
            }),
            signal: transformController.signal,
          });
        } catch (error) {
          if (error.name === 'AbortError')
            throw new Error('Caption transformation provider timed out.', { cause: error });
          throw error;
        } finally {
          clearTimeout(transformTimer);
        }
        const transformedPayload = await transformed.json().catch(() => ({}));
        if (!transformed.ok) {
          throw new Error(transformedPayload.error?.message || `Caption transform failed (${transformed.status}).`);
        }
        text = String(transformedPayload.choices?.[0]?.message?.content || '').trim() || text;
      }
      return text;
    };

    const deliver = (details, result) => {
      const wc = ctx.electron.webContents.fromId(details.webContentsId);
      if (!wc || wc.isDestroyed()) return;
      const source = `window.dispatchEvent(new CustomEvent('slick:better-captions-result',{detail:${JSON.stringify(result)}}))`;
      wc.executeJavaScript(source, true).catch((error) => ctx.log('could not deliver caption:', error.message));
    };

    ctx.interceptRequests(['https://slick.better-captions/*'], (details) => {
      const url = new URL(details.url);
      if (details.method !== 'POST') return { cancel: true };
      if (url.pathname === '/capture') {
        const id = url.searchParams.get('id') || '';
        if (!/^[a-zA-Z0-9-]{8,64}$/.test(id)) return { cancel: true };
        try {
          armCapture();
          deliver(details, { id, captureReady: true });
        } catch (error) {
          ctx.log('capture error:', error.message);
          deliver(details, { id, error: error.message || 'Could not activate system-audio capture.' });
        }
        return { cancel: true };
      }
      if (url.pathname !== '/transcribe') return { cancel: true };
      const id = url.searchParams.get('id') || '';
      if (!/^[a-zA-Z0-9-]{8,64}$/.test(id)) return { cancel: true };
      const wc = ctx.electron.webContents.fromId(details.webContentsId);
      const session = wc?.session || ctx.electron.session.defaultSession;
      const audio = Promise.all(
        (details.uploadData || []).map(async (entry) => {
          if (entry.bytes) return Buffer.from(entry.bytes);
          if (entry.blobUUID) return session.getBlobData(entry.blobUUID);
          return Buffer.alloc(0);
        }),
      ).then((chunks) => Buffer.concat(chunks));
      void audio
        .then((bytes) => {
          if (!bytes.length || bytes.length > 10 * 1024 * 1024)
            throw new Error('Captured audio was empty or too large.');
          return transcribe(new Blob([bytes], { type: 'audio/webm' }));
        })
        .then((text) => deliver(details, { id, text }))
        .catch((error) => {
          ctx.log('transcription error:', error.message);
          deliver(details, { id, error: error.message || 'Transcription failed.' });
        });
      return { cancel: true };
    });

    ctx.app.whenReady().then(() => {
      retainSession(ctx.electron.session.defaultSession);
    });
  },
};
