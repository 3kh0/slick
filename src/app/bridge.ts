// The SlickBridge surface the preload exposes, typed without Electron imports.

import type { BlobStore } from './api/storage.ts';

export type PluginChannel = {
  call<T = unknown>(method: string, ...args: unknown[]): Promise<T>;
  on(event: string, cb: (payload: unknown) => void): () => void;
};

export interface SlickBridge {
  loader: 'electron' | 'extension' | 'userscript';
  loaderVersion: string;
  bridgeVersion: number;
  safeMode: boolean;
  paths: Record<string, string>;

  readSettings(): Promise<string>;
  writeSettings(text: string): Promise<boolean>;
  /** Optional atomic update. False means the expected text is stale; reread and retry. */
  compareAndSwapSettings?(expected: string, text: string): Promise<boolean>;
  onSettingsChange(cb: (text: string) => void): () => void;

  readUserCss(): Promise<string>;
  writeUserCss(css: string): Promise<boolean>;
  onUserCssChange(cb: (css: string) => void): () => void;

  openFile(title: string, accept?: string): Promise<string>;
  openCssEditor(): Promise<boolean>;

  blobStore(namespace: string): BlobStore;
  plugin(id: string): PluginChannel;

  fetch(url: string, init?: RequestInit): Promise<{ status: number; body: string }>;
}

// The preload global is a one-shot claim (contextBridge makes it
// non-configurable), so it is claimed at module evaluation, before Slack's
// bundle runs. Null means something claimed first: we are not running first.
const capturedBridge = (() => {
  const claim = (globalThis as any).SlickBridge?.claim;
  if (typeof claim !== 'function') return null;
  const bridge = claim();
  if (!bridge) console.error('[slick] the bridge was already claimed; Slick did not run first');
  return bridge;
})();

export function getBridge(): SlickBridge | null {
  const bridge = capturedBridge;
  if (!bridge?.loader || typeof bridge.bridgeVersion !== 'number') return null;
  return bridge as SlickBridge;
}
