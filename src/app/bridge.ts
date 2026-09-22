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

export function getBridge(): SlickBridge | null {
  const bridge = (globalThis as any).SlickBridge;
  if (!bridge?.loader || typeof bridge.bridgeVersion !== 'number') return null;
  return bridge as SlickBridge;
}
