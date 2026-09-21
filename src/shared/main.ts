// Slick Main-Process Plugin Contract
//
// 13 of Slick's plugins do privileged work that cannot happen in the page:
// custom protocol schemes, request blocking and interception, cross-origin
// subframe injection, native notification suppression, display-media capture.
// Taut has no equivalent -- its bridge is a closed RPC table -- so this is the
// one genuinely slick-specific part of the architecture.
//
// A plugin's `main.ts` default-exports one of these. The renderer half reaches
// it through `api.main.call(...)`, never by naming another plugin's id.

import type { PluginSettings } from './settings.ts';

/**
 * Everything a main-process plugin half is allowed to touch. Undeclared
 * capabilities throw when used. This is a review aid rather than a sandbox:
 * `frames` in particular can inject script into cross-origin frames, so
 * changes to a main.ts deserve the same scrutiny as changes to the loader.
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
  | 'dialog'; // native file pickers

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
   * requires `notifications`
   *
   * One shared patch of Slack's notification path, with plugins registering
   * predicates. v1 had StreamerMode and ShutUpSlackbot each monkey-patching
   * `Notification.prototype.show` independently, so whichever installed second
   * silently defeated the other.
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
}

export type RpcHandler = (ctx: MainCtx, args: unknown[], sender: Electron.WebContents) => unknown;

export interface SlickMainPlugin {
  /** Must equal the renderer class's static id. */
  id: string;
  capabilities: Capability[];

  /**
   * Before `app.whenReady()`. The only place `registerSchemesAsPrivileged`
   * and Chromium switches work.
   */
  boot?(ctx: MainCtx): void;

  /** After `app.whenReady()`. */
  ready?(ctx: MainCtx): void | Promise<void>;

  /** Per Slack BrowserWindow. */
  window?(ctx: MainCtx, window: Electron.BrowserWindow): void;

  /**
   * The renderer-callable surface. Own properties only -- the dispatcher
   * refuses anything reached through the prototype chain.
   */
  rpc?: Record<string, RpcHandler>;
}
