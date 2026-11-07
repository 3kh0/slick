import type { SlickMainPlugin } from '$slick';
import { app, webContents } from 'electron';
import { silenceAttention } from './attention.ts';
import { BREAK_KEY, breakEnd, storedEnd } from './break.ts';
import { id } from './meta.ts';

let until = 0;
const windows = new Set<Electron.WebContents>();
const muted = new Map<Electron.WebContents, boolean>();
let attention: ReturnType<typeof silenceAttention> | undefined;

function updateAudio() {
  attention?.update();
  const active = until > Date.now();
  for (const contents of webContents.getAllWebContents()) {
    if (contents.getURL().startsWith('https://app.slack.com/')) windows.add(contents);
  }
  for (const contents of windows) {
    if (contents.isDestroyed()) {
      windows.delete(contents);
      muted.delete(contents);
      continue;
    }
    if (active) {
      if (!muted.has(contents)) muted.set(contents, contents.isAudioMuted());
      contents.setAudioMuted(true);
    } else if (muted.has(contents)) {
      contents.setAudioMuted(muted.get(contents)!);
      muted.delete(contents);
    }
  }
}

export default {
  id,
  capabilities: ['notifications'],
  async ready(ctx) {
    const removeFilter = ctx.notifications.filter(() => until <= Date.now());
    try {
      until = storedEnd(JSON.parse((await ctx.storage.read(BREAK_KEY)) ?? '0'));
    } catch (error) {
      removeFilter();
      throw error;
    }
    attention = silenceAttention(app, () => until > Date.now());
    updateAudio();
    const timer = setInterval(updateAudio, 1000);
    return () => {
      clearInterval(timer);
      removeFilter();
      until = 0;
      updateAudio();
      attention?.dispose();
      attention = undefined;
      windows.clear();
    };
  },
  window(_ctx, window) {
    const contents = window.webContents;
    windows.add(contents);
    contents.once('destroyed', () => {
      windows.delete(contents);
      muted.delete(contents);
    });
    updateAudio();
  },
  rpc: {
    status() {
      return until;
    },
    async begin(ctx, [minutes]) {
      if (until > Date.now()) return until;
      const next = breakEnd(minutes);
      if (!(await ctx.storage.write(BREAK_KEY, JSON.stringify(next)))) {
        throw new Error('Could not save your break. Please try again.');
      }
      until = next;
      updateAudio();
      ctx.emit('started', until);
      return until;
    },
  },
} satisfies SlickMainPlugin;
