// Slick Plugin Base Class
//
// Every plugin is a class extending SlickPlugin, constructed with its scoped
// API and resolved config. Plugins are bundled individually and evaluated by
// the plugin manager, so they can be enabled and disabled without a reload.
//
// Import this as `$slick` (see tsconfig paths).

import type { SlickAPI } from '../app/pluginManager.ts';
import type { PluginSettings, SettingsSchema } from './settings.ts';

export type { SlickAPI } from '../app/pluginManager.ts';
export type { SlackActivityItem, SlackAttachment, SlackBot, SlackMessage } from '../app/slack/messages.ts';
export type { MapEntry, SlackStore } from '../app/slack/redux.ts';
export type { RtmEvent } from '../app/slack/rtm.ts';
export type { ComponentReplacer, ComponentType, PatchMatcher } from '../app/slack/react.tsx';
export type { SlackMember } from '../app/slack/members.ts';
export type { SlackChannel } from '../app/slack/channels.ts';
export type { Block, FromDeltaOptions } from '../app/slack/blocks.ts';
export type { Delta, DeltaOp } from './delta.ts';
export type { MenuTemplateItem, SelectOption } from '../app/api/elements.ts';
export type { PluginSettings, Setting, SettingsSchema, SettingValue } from './settings.ts';
export type { Capability, MainCtx, SlickMainPlugin } from './main.ts';

export abstract class SlickPlugin<Schema extends SettingsSchema = SettingsSchema> {
  /** Must match the filename and the settings key. */
  static readonly id: string;
  /** Shown in Preferences. */
  static readonly pluginName: string;
  static readonly description: string;
  /** Slack user IDs, `<@U…>` style, as v1's plugin metadata used. */
  static readonly authors: string = '';
  /** Whether the plugin is on for someone who has never touched its settings. */
  static readonly defaultEnabled: boolean = false;
  /** Typed schema; drives Preferences and the extension options page. */
  static readonly settings: SettingsSchema = {};

  /**
   * Settings that take effect without restarting the plugin. Everything else
   * stops and restarts it on change, which is simpler but loses in-memory
   * state. A live key that a redux slice patch reads must also be handled by
   * calling `api.redux.refresh()` from `onSettingsChange`, or the patch keeps
   * serving memoized results from the old settings.
   */
  static readonly liveSettings: readonly string[] = [];

  /** Settings that need a full app relaunch (Chromium switches). */
  static readonly relaunchSettings: readonly string[] = [];

  constructor(
    protected api: SlickAPI,
    protected config: PluginSettings & { [K in keyof Schema]: any },
  ) {}

  /**
   * Install the plugin's hooks. Only await fast local work here: everything
   * runs before Slack finishes booting, and a slow start delays every plugin
   * after it. Background work should be cancelled with `this.api.signal`.
   */
  abstract start(): void | Promise<void>;

  /**
   * Release anything the API did not hand back a disposer for. Every
   * registration made through `this.api` is torn down automatically.
   */
  stop(): void | Promise<void> {}

  /** Called for a `liveSettings` key instead of a restart. */
  onSettingsChange(_changed: string[]): void | Promise<void> {}

  protected log = (...args: unknown[]) => {
    console.log(`[slick] [${(this.constructor as typeof SlickPlugin).pluginName}]`, ...args);
  };
}

export interface SlickPluginConstructor {
  new (api: SlickAPI, config: any): SlickPlugin;
  readonly id: string;
  readonly pluginName: string;
  readonly description: string;
  readonly authors: string;
  readonly defaultEnabled: boolean;
  readonly settings: SettingsSchema;
  readonly liveSettings: readonly string[];
  readonly relaunchSettings: readonly string[];
}

export default SlickPlugin;
