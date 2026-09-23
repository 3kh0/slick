// Contract for a plugin's privileged `main.ts` half (default export). The
// renderer half reaches it only through `api.main.call(...)`.

import type { PluginSettings } from './settings.ts';

/**
 * Undeclared capabilities throw when used. A review aid, not a sandbox:
 * `frames` can inject into cross-origin frames, so review main.ts changes like
 * loader changes.
 */
export type Capability =
  | 'protocol' // register a privileged scheme and serve local files
  | 'requests' // block or intercept requests
  | 'frames' // run code in subframes, including cross-origin ones
  | 'notifications' // veto native notifications
  | 'switches' // append Chromium command-line switches (boot only)
  | 'shell' // open external URLs
  | 'net' // privileged HTTP, bypassing page CORS
  | 'media' // handle display-media (screen/audio capture) requests
  | 'dialog' // native file pickers
  | 'cookies' // read or replace Slack session cookies
  | 'secrets'; // encrypted plugin-scoped storage

export type ProtocolPrivileges = {
  standard?: boolean;
  secure?: boolean;
  supportFetchAPI?: boolean;
  corsEnabled?: boolean;
  stream?: boolean;
};

export interface MainCtx {
  readonly id: string;
  readonly settings: PluginSettings;
  onSettingsChange(cb: (settings: PluginSettings) => void): () => void;
  log(...args: unknown[]): void;

  /** Push an event to this plugin's renderer half. */
  emit(event: string, payload?: unknown): void;
  emitTo(contents: Electron.WebContents, event: string, payload?: unknown): void;

  /** Durable per-plugin storage, the same namespace the renderer's api.storage uses. */
  storage: {
    list(): Promise<string[]>;
    readAll(prefix?: string): Promise<Record<string, string>>;
    read(key: string): Promise<string | null>;
    write(key: string, value: string): Promise<boolean>;
    delete(key: string): Promise<boolean>;
    clear(): Promise<boolean>;
  };

  /** requires `protocol`; the scheme must be declared during `boot` */
  protocol: {
    register(
      scheme: string,
      privileges: ProtocolPrivileges,
      handler: (request: Request) => Response | Promise<Response>,
    ): void;
  };

  /** requires `requests` / `net` */
  net: {
    block(patterns: string[]): () => void;
    intercept(
      patterns: string[],
      handler: (details: any) => { cancel?: boolean; redirectURL?: string } | void,
    ): () => void;
    fetch(url: string, init?: RequestInit): Promise<{ status: number; body: string }>;
  };

  /** requires `frames` */
  frames: {
    onFrame(cb: (frame: Electron.WebFrameMain, contents: Electron.WebContents) => void): () => void;
  };

  /**
   * requires `notifications`. One shared patch of the notification path, so
   * plugins' predicates compose instead of clobbering each other's patches.
   */
  notifications: {
    filter(predicate: (options: Electron.NotificationConstructorOptions) => boolean): () => void;
  };

  /** requires `media` */
  media: {
    onDisplayMediaRequest(handler: (request: any) => any): () => void;
  };

  /** requires `switches`; valid only during `boot` */
  switches: {
    append(name: string, value?: string): void;
  };

  /** requires `shell` */
  shell: {
    openExternal(url: string): Promise<void>;
  };

  /** requires `dialog` */
  dialog: {
    openFile(options?: Electron.OpenDialogOptions): Promise<string>;
  };

  /** requires `cookies` */
  cookies: {
    get(details: Electron.CookiesGetFilter): Promise<Electron.Cookie | null>;
    set(details: Electron.CookiesSetDetails): Promise<void>;
    remove(url: string, name: string): Promise<void>;
  };

  secrets: {
    read(key: string): Promise<string | null>;
    write(key: string, value: string): Promise<boolean>;
    delete(key: string): Promise<boolean>;
  };
}

export type RpcHandler = (ctx: MainCtx, args: unknown[], sender: Electron.WebContents) => unknown;

export interface SlickMainPlugin {
  /** Must equal the renderer class's static id. */
  id: string;
  capabilities: Capability[];

  /** Before `app.whenReady()`: the only place schemes and switches can be registered. */
  boot?(ctx: MainCtx): void;

  /** After `app.whenReady()`. Return a disposer for runtime disablement. */
  ready?(ctx: MainCtx): void | (() => void | Promise<void>) | Promise<void | (() => void | Promise<void>)>;

  /** Per Slack BrowserWindow. */
  window?(ctx: MainCtx, window: Electron.BrowserWindow): void;

  /** Renderer-callable; the dispatcher only accepts own properties. */
  rpc?: Record<string, RpcHandler>;
}
