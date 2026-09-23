// Plugin base class. Import as `$slick` (see tsconfig paths).

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
  /** Slack user IDs, `<@U…>` style. */
  static readonly authors: string = '';
  static readonly defaultEnabled: boolean = false;
  /** Typed schema; drives Preferences and the extension options page. */
  static readonly settings: SettingsSchema = {};

  /**
   * Settings applied without restarting the plugin (others restart it). A live
   * key read by a redux slice patch needs `api.redux.refresh()` in
   * `onSettingsChange`, or the patch keeps serving memoized results.
   */
  static readonly liveSettings: readonly string[] = [];

  /** Settings that need a full app relaunch (Chromium switches). */
  static readonly relaunchSettings: readonly string[] = [];

  constructor(
    protected api: SlickAPI,
    protected config: PluginSettings & { [K in keyof Schema]: any },
  ) {}

  /**
   * Only await fast local work: a slow start delays every later plugin and
   * Slack's boot. Cancel background work with `this.api.signal`.
   */
  abstract start(): void | Promise<void>;

  /** Registrations made through `this.api` are torn down automatically. */
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
