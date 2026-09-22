// The SlickBridge surface, as the preload exposes it.
// Typed here so the app can be checked without importing Electron types.

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
  onSettingsChange(cb: (text: string) => void): () => void;

  readUserCss(): Promise<string>;
  writeUserCss(css: string): Promise<boolean>;
  onUserCssChange(cb: (css: string) => void): () => void;

  openFile(title: string, accept?: string): Promise<string>;
  /** No-op until the Phase 4 CSS editor window is implemented. */
  openCssEditor(): Promise<boolean>;

  blobStore(namespace: string): BlobStore;
  plugin(id: string): PluginChannel;

  fetch(url: string, init?: RequestInit): Promise<{ status: number; body: string }>;

  start(): Promise<unknown>;
}

// The global the preload exposes is a one-shot claim, not the API: the name
// itself cannot be removed (contextBridge defines it non-configurably), so the
// protection is that slick.js runs before Slack's bundle and takes the handle
// first. Claiming here, while this module evaluates, is what makes that true.
//
// A null result means something claimed before us, which should be impossible
// and means we are not running first after all.
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
