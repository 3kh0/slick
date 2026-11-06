// Dev only (SLICK_HOT): scripts/desktop.ts writes hot/update.json after each
// rebuild; plugin updates go to the page (app/hot.ts), anything else reloads it.
// session.ts serves the bundles from hot/.

import { mkdirSync, readFileSync, watch } from 'node:fs';
import path from 'node:path';
import { webContents } from 'electron';
import { broadcast, isSlackClient } from './bridge.ts';

export function watchHotUpdates(dir: string) {
  mkdirSync(dir, { recursive: true });
  let last = 0;
  watch(dir, (_event, name) => {
    if (name !== 'update.json') return;
    let u: { seq: number; reload?: true; plugins?: string[] };
    try {
      u = JSON.parse(readFileSync(path.join(dir, name), 'utf8'));
    } catch {
      return;
    }
    if (!(u.seq > last)) return;
    last = u.seq;
    if (u.reload) {
      console.log('[slick] hot: reloading Slack');
      for (const c of webContents.getAllWebContents()) if (!c.isDestroyed() && isSlackClient(c.mainFrame)) c.reload();
    }
    for (const plugin of u.plugins ?? []) {
      console.log(`[slick] hot: ${plugin}`);
      broadcast('slick:hot', `slick://app/hot/${plugin}.js?v=${u.seq}`);
    }
  });
}
