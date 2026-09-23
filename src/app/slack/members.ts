// Slack denormalizes names into lowercase/deburred fields that search,
// autocomplete and sort read instead of `profile.display_name`, so
// `modifyMemberObject` rewrites all of them.

import { retry } from '../helpers.ts';
import { reactReady } from './react.tsx';
import { dispatchThunk, getRawState, getStore, reduxReady } from './redux.ts';
import { waitForExport } from './webpack.ts';

export type SlackMember = {
  id?: string;
  name?: string;
  real_name?: string;
  deleted?: boolean;
  isUnknown?: boolean;
  isNonExistent?: boolean;
  profile?: {
    display_name?: string;
    real_name?: string;
    image_24?: string;
    image_48?: string;
    image_72?: string;
    image_192?: string;
    image_512?: string;
    [key: string]: unknown;
  };
  [key: string]: unknown;
};

type GetMemberById = (state: any, userId: string) => SlackMember | undefined;

// Mirrors Slack's own `computeDerivedNames`.
const deburr = (value: string): string => value.normalize('NFKD').replace(/[̀-ͯ]/g, '');
const lc = (value: string): string => String(value).toLowerCase();

export function modifyMemberObject(
  member: SlackMember,
  edits: {
    /** Sets both the display name and the real name. */
    name?: string;
    /** Defaults to `name`. */
    displayName?: string;
    /** Defaults to `name`. */
    realName?: string;
  },
): SlackMember {
  const profile = { ...member.profile };
  const next: SlackMember = { ...member, profile };

  const { name, displayName = name, realName = name } = edits;
  if (displayName !== undefined) {
    profile.display_name = displayName;
    profile.display_name_normalized = deburr(displayName);
    next._display_name_lc = lc(displayName);
    next._display_name_normalized_lc = deburr(lc(displayName));
  }
  if (realName !== undefined) {
    next.real_name = realName;
    profile.real_name = realName;
    profile.real_name_normalized = deburr(realName);
    next._real_name_lc = lc(realName);
    next._real_name_normalized_lc = deburr(lc(realName));
  }

  return next;
}

/** Unfetched members are empty-named placeholders; never hand them to plugins. */
const loaded = (member?: SlackMember): SlackMember | undefined =>
  !member || member.isUnknown === true || member.isNonExistent === true ? undefined : member;

export function getCachedMember(userId: string): SlackMember | undefined {
  return loaded(getStore()?.getState().members?.[userId]);
}

export function getCurrentMemberId(): string | undefined {
  return getRawState()?.bootData?.user_id;
}

const inFlight = new Map<string, Promise<SlackMember | undefined>>();
let batch: { ids: Set<string>; done: Promise<void> } | undefined;

/** Coalesce a burst of lookups (a mounting message list) into one thunk, avoiding rate limits. */
function fetchMembers(userId: string): Promise<void> {
  if (!batch) {
    const ids = new Set<string>();
    const done = new Promise<void>((resolve) => setTimeout(resolve, 5)).then(async () => {
      batch = undefined;
      try {
        await dispatchThunk('ensureMembersArePresent', { memberIds: [...ids], reason: 'slick' });
      } catch {}
    });
    batch = { ids, done };
  }
  batch.ids.add(userId);
  return batch.done;
}

export async function getMember(userId: string): Promise<SlackMember | undefined> {
  const cached = getCachedMember(userId);
  if (cached) return cached;

  const pending = inFlight.get(userId);
  if (pending) return pending;

  const request = retry(
    async () => {
      await fetchMembers(userId);
      return getCachedMember(userId);
    },
    { tries: 4, baseMs: 3000 },
  ).finally(() => inFlight.delete(userId));

  inFlight.set(userId, request);
  return request;
}

export const membersReady = (async () => {
  const React = await reactReady;
  const { useReduxState } = await reduxReady;

  // Slack's selector resolves aliases and shared-channel members a bare read misses.
  let selector: GetMemberById | undefined;
  void waitForExport<GetMemberById>(
    (exp: any) => typeof exp === 'function' && exp.meta?.key === 'createSelectorGetMemberById',
  ).then((found) => {
    selector = found;
  });

  const readMember: GetMemberById = (state, userId) => selector?.(state, userId) ?? state.members?.[userId];

  function useMember(userId: string): SlackMember | undefined {
    const member = useReduxState<SlackMember | undefined>((state) => loaded(readMember(state, userId)));
    const missing = !member;
    React.useEffect(() => {
      if (userId && missing) void getMember(userId);
    }, [userId, missing]);
    return member;
  }

  return { getCachedMember, getCurrentMemberId, getMember, useMember, modifyMemberObject };
})();

export type MembersAPI = Awaited<typeof membersReady>;
