// Reading Slack channels from the redux store, and building channel objects
// Slack will accept from a handful of known fields.
//
// `makeChannelObject` exists because a channel synthesized by a plugin has to
// carry the same denormalized name fields a real one does, or autocomplete
// and search will not find it.

import { getStore } from './redux.ts';

export type SlackChannel = {
  id?: string;
  name?: string;
  name_normalized?: string;
  _name_lc?: string;
  is_channel?: boolean;
  is_group?: boolean;
  is_im?: boolean;
  is_mpim?: boolean;
  is_private?: boolean;
  is_member?: boolean;
  is_archived?: boolean;
  is_general?: boolean;
  previous_names?: string[];
  isNonExistent?: boolean;
  isUnknown?: boolean;
  [key: string]: unknown;
};

const deburr = (value: string): string => value.normalize('NFKD').replace(/[̀-ͯ]/g, '');
const lc = (value: string): string => String(value).toLowerCase();

export function makeChannelObject(channel: {
  id: string;
  name: string;
  isPrivate?: boolean;
  isMember?: boolean;
  isArchived?: boolean;
  /** Former names, which autocomplete also matches against. */
  previousNames?: string[];
}): SlackChannel {
  const { id, name, isPrivate = false, isMember = false, isArchived = false, previousNames = [] } = channel;
  return {
    id,
    name,
    name_normalized: deburr(name),
    _name_lc: deburr(lc(name)),
    is_channel: !isPrivate,
    is_group: isPrivate,
    is_im: false,
    is_mpim: false,
    is_private: isPrivate,
    is_member: isMember,
    is_archived: isArchived,
    is_general: false,
    previous_names: previousNames,
    isNonExistent: false,
    isUnknown: false,
  };
}

export function getCachedChannel(channelId: string): SlackChannel | undefined {
  return getStore()?.getState().channels?.[channelId];
}

/** The channel currently on screen, if the client is looking at one. */
export function getCurrentChannelId(): string | undefined {
  return getStore()?.getState().view?.channelId;
}

export const channelsReady = (async () => ({ getCachedChannel, getCurrentChannelId, makeChannelObject }))();

export type ChannelsAPI = Awaited<typeof channelsReady>;
