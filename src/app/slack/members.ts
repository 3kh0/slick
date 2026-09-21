// Reading Slack member profiles out of the redux store.
//
// The interesting part is `modifyMemberObject`. Slack denormalizes every name
// into six lowercase/deburred fields and its search, autocomplete and sort
// paths read those rather than `profile.display_name`. Rewriting only the
// display field leaves the member findable under the old name, which is how a
// rename plugin ends up half-working.

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

/**
 * A copy of `member` with the named fields replaced, including every
 * denormalized form Slack derives from them.
 */
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

/**
 * Slack stands in a member it has not fetched with a placeholder carrying
 * empty names and a `profile` object shared by every other placeholder.
 * Handing one to a plugin would look like a member whose name is the empty
 * string, so they never leave this module.
 */
const loaded = (member?: SlackMember): SlackMember | undefined =>
  !member || member.isUnknown === true || member.isNonExistent === true ? undefined : member;

export function getCachedMember(userId: string): SlackMember | undefined {
  return loaded(getStore()?.getState().members?.[userId]);
}

/** The member this client is signed in as. */
export function getCurrentMemberId(): string | undefined {
  return getRawState()?.bootData?.user_id;
}

const inFlight = new Map<string, Promise<SlackMember | undefined>>();
let batch: { ids: Set<string>; done: Promise<void> } | undefined;

/**
 * Coalesce a burst of lookups into one thunk. A message list mounting asks for
 * dozens of members in the same tick, and one request per member is both slow
 * and a good way to get rate limited.
 */
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

/** Get a member, asking Slack to fetch them if the store has not got them. */
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

  // Slack's own memoized selector, when it is available: it resolves aliases
  // and shared-channel members that a bare `state.members` read misses.
  let selector: GetMemberById | undefined;
  void waitForExport<GetMemberById>(
    (exp: any) => typeof exp === 'function' && exp.meta?.key === 'createSelectorGetMemberById',
  ).then((found) => {
    selector = found;
  });

  const readMember: GetMemberById = (state, userId) => selector?.(state, userId) ?? state.members?.[userId];

  /** Reactively read a member, asking Slack to load them if it has not yet. */
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
