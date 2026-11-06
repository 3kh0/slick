// What the call window needs from the plugin, handed down once instead of
// threading props through every tile.

import type { SlackMember } from '$slick';
import type { CallState, HuddleCall } from '../huddleCall.ts';
import type { CallPreferences } from '../preferences.ts';

export interface HuddleUiServices {
  call: HuddleCall;
  /** Slick's `members.useMember` (a hook: same call order every render). */
  useMember: (userId: string) => SlackMember | undefined;
  /** "#general" / a DM partner's name for a conversation id. */
  conversationLabel: (channelId: string) => string;
  /** Whether a new call starts as a floating window or filling the page. */
  initialLayout: () => 'window' | 'page';
  /** The "shrink people without video" setting, live (a hook). */
  useCompactNoVideo: () => boolean;
}

// Created on first use: plugin modules load before Slack has published its React global.
let context: React.Context<HuddleUiServices | null> | null = null;

export function huddleUiContext(): React.Context<HuddleUiServices | null> {
  context ??= React.createContext<HuddleUiServices | null>(null);
  return context;
}

export function useHuddleUi(): HuddleUiServices {
  const services = React.useContext(huddleUiContext());
  if (!services) throw new Error('[slick] [Better Huddles] call UI rendered outside its context provider');
  return services;
}

export function useCallState(): CallState {
  const { call } = useHuddleUi();
  return React.useSyncExternalStore(call.state.subscribe, call.state.get);
}

export function usePreferences(): CallPreferences {
  const { call } = useHuddleUi();
  return React.useSyncExternalStore(call.preferences.subscribe, call.preferences.get);
}
