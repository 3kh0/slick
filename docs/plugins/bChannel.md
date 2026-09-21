# Handoff: bChannel

**Status:** not ported, and the only plugin it is reasonable to ship v2 without.
v1 lives at `plugins/bChannel/{index.js,renderer.js}` (166 + **1538** lines).

Read `PORTING.md` first.

---

## Why this one is different

Every other plugin addresses Slack by a name — a component `displayName`, a
thunk name, a redux slice. bChannel addresses it by **minified module id**:

```js
runtimeRequire('eh+y').qY(...)      // renderer.js:90, :1227, :1240
runtimeRequire('M9P0').Kn({...})    // renderer.js:93, :1253
runtimeRequire('M9P0').Cw({...})    // renderer.js:1231
runtimeRequire('Tid6').y({...})     // renderer.js:1266
runtimeRequire('DiPi').A            // renderer.js:501
```

Those ids are assigned by Slack's bundler. They change without warning, there
is no fallback in the current code, and when they change the plugin does not
degrade — it throws inside an empty `catch` and silently does nothing.

**This is the work.** Porting the rest of bChannel is ordinary; re-addressing
these five is the whole risk.

---

## What each one is, as far as the call sites show

| id     | member | signature at the call site                                                      | what it does                                                            |
| ------ | ------ | ------------------------------------------------------------------------------- | ----------------------------------------------------------------------- |
| `eh+y` | `qY`   | `(dispatch, getState, channelId, [userIds]) → Promise<Record<userId, boolean>>` | is each user a member of this channel                                   |
| `M9P0` | `Kn`   | thunk creator `({ channelId, prefName, reason })`                               | read a channel preference (used with `who_can_post`)                    |
| `M9P0` | `Cw`   | thunk creator `({ channelId, users, reason })`                                  | invite users to a channel                                               |
| `Tid6` | `y`    | thunk creator `({ channelId, newPrefs, reason })`                               | write channel preferences                                               |
| `DiPi` | `A`    | —                                                                               | **solved.** This is `convertDeltaToBlocks`; use `api.blocks.fromDelta`. |

Three of the four unsolved ones are dispatched through `store.dispatch(...)`,
which means they are almost certainly **named thunk creators** and therefore
addressable with `redux.waitForThunkCreator(name)`. The registry resolves
4,994 named creators in Slack 4.52.155, so the name is very likely in there.

`eh+y.qY` is the odd one out: it takes `dispatch` and `getState` directly
rather than being dispatched, so it is a plain helper and will need
`getByProps` or a signature match instead.

---

## Do this first

Against a running Slack with DevTools open. The debug globals are already
exposed for exactly this (`getStore`, `getRawState`, `getThunkCreator`,
`thunkNames`, `allExports`, `getValueSource`, `getComponent`).

1. `thunkNames()` and grep for plausible names — `channelPref`, `whoCanPost`,
   `inviteToChannel`, `setChannelPrefs`, `fetchChannelPref`. Expect something
   close to `getChannelPrefByApi` / `setChannelPrefsByApi` /
   `inviteUsersToChannelByApi`.
2. Confirm each candidate by `getValueSource(getThunkCreator(name))` and
   checking the call shape matches the table above.
3. For `eh+y.qY`, search exports for a function of arity 4 whose source
   mentions membership, then confirm with a live call on a channel you are in.
4. **Record every name in `docs/slack-internals.md`.** That file is the point:
   the next Slack rename should be a one-file fix, not a re-run of this.

If a name cannot be found, stop and say so. Do not ship an id.

---

## What the plugin actually does

Posts to a channel as a bot relay, via the bChannel service
(`https://bc.deployor.dev`, configurable). Before it can, the channel has to be
ready: the bot must be a member, and `who_can_post` must permit it. The four
module calls are that preflight — check membership, read the pref, invite the
bot, write the pref back.

Note the two retry loops (`renderer.js:1236`, `:1275`): after changing
membership or prefs, Slack's own state takes several seconds to catch up, so it
re-checks with a backoff up to ten times. Keep that. Without it the plugin
appears to work and then posts fail.

## Settings (port verbatim)

| key          | type | default                   |
| ------------ | ---- | ------------------------- |
| `serviceUrl` | text | `https://bc.deployor.dev` |

---

## Traps

**This plugin changes other people's workspace.** It invites a bot to channels
and rewrites `who_can_post`. Those are real, visible, administrative changes,
and `renderer.js` tracks `changedSlackState` precisely because they need
undoing. Any port must keep that: know what it changed, and be able to put it
back.

**Every failure path in v1 is an empty `catch`.** That is why a bundler rename
turns into "bChannel stopped working and nobody knows why". The port must log,
and must distinguish "Slack said no" from "we could not find the function".

**`getSlackRequire` goes away.** v2 has the module registry
(`src/app/slack/webpack.ts`); reaching for Slack's raw `require` is not needed
and should not be reintroduced.

---

## Verification

1. Every address resolves by name at startup, and the plugin logs loudly and
   disables itself if one does not.
2. Post to a channel where the bot is already set up: it works.
3. Post to a channel where it is not: the bot is invited, the pref is updated,
   and the post lands — and the retry loop is actually exercised (it will be;
   Slack is slow here).
4. Anything it changed can be identified afterwards.
5. Disable the plugin: no residue, no listeners, no pending retries.
