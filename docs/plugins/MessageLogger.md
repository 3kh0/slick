# Handoff: MessageLogger

**Status:** ported. Lives in `src/plugins/MessageLogger/`, with `injectMessages` in `src/app/slack/messages.ts` and RTM in `src/app/slack/rtm.ts`.

**What it does:** keeps deleted and edited messages visible, styled so it is
obvious they are gone or changed.

**v1 source (still on `main`):** `plugins/MessageLogger/{index.js,renderer.js}`
(46 + **921** lines). Expect to delete roughly 800 of those.

This is one of the two long poles of the port (the other is `bChannel`). Budget
it separately from the ordinary plugins.

---

## Why it is being rewritten

v1 does all of this at once:

- patches `window.WebSocket` wholesale (`renderer.js:614-682`) to see
  `message_deleted` and `message_changed` events
- patches `window.fetch` (`:787`) **and** `XMLHttpRequest.prototype` (`:797`)
  to catch the same events over the HTTP fallback
- re-synthesises `message_changed` events (`:499-553`) to put deleted messages
  back into Slack's own flow
- subscribes to the DOM hub (`:912`) to style what it reinserted
- persists to `localStorage` (`:36-44`), which is per-origin rather than
  per-plugin and invisible to Preferences

v2 replaces the first three with `api.rtm.on`, the fourth with a component
patch, and the fifth with `api.storage`.

---

## The mechanism to copy

Taut solves exactly this problem in `app/slack/messages.ts` → `injectMessages`.
Port that helper into `src/app/slack/messages.ts` first; MessageLogger is its
only consumer right now, but ShowRealUser will want the rest of that module.

**Re-inserting a message takes two coordinated patches, not one.**

1. `patchSlice('messages', ...)` — put the message object back at
   `messages[channelId][ts]`, using `mapEntries`' third argument (`addedKeys`)
   so a timestamp Slack does not have still materialises.

2. `patchSlice('channelHistory', ...)` — **this is the one that is easy to
   miss.** Slack renders a conversation from
   `channelHistory[key].slices[].timestamps`, not by enumerating `messages`.
   A message that exists in `messages` but is absent from the timestamps array
   is simply never drawn. The injected `ts` has to be spliced into the right
   slice, in sorted order.

Details that matter in step 2:

- the history key is `channelId` for the channel itself and
  `channelId-threadTs` for a thread view, so it must be split
- a slice only covers a `ts` between its `start` and `end`, except that the
  first slice also covers everything older when `reachedStart` is true, and
  the last covers everything newer when `reachedEnd` is true
- Slack timestamps are fixed-width, so a plain string sort is correct
- in a channel view a threaded reply only belongs in history if
  `thread_ts === ts` or `subtype === 'thread_broadcast'`

Taut's `withTimestamps` and `inHistory` implement all of the above; read them
rather than re-deriving.

---

## Traps

**`state.messages` is nested two levels deep** — `messages[channelId][ts]`.
A single-level `patchSlice('messages', (id, msg) => ...)` receives a channel
bucket, not a message. It compiles, runs, and does nothing.

**An empty `messages` slice is usually a probe problem.** In unattended
`npm run desktop:dev` runs the window is never focused and `messages`,
`channels`, `members` and `view` all stay empty for the whole session. Test
with a focused window on an open channel. See `docs/slack-internals.md`.

**`injectMessages` is silent when it breaks.** If Slack reshapes
`channelHistory`, deleted messages just stop appearing — no error, no log. Add
a runtime assertion that the expected `slices[].timestamps` shape exists, and a
diagnostic counter for injected-vs-rendered, so a future Slack change surfaces
as a warning rather than as a user wondering why the plugin stopped working.

---

## Settings (port verbatim from v1)

| key             | type    | default | notes                                                                                     |
| --------------- | ------- | ------- | ----------------------------------------------------------------------------------------- |
| `deletedStyle`  | select  | `red`   | `red` (red font) \| `opacity` (50%)                                                       |
| `ignoreSelf`    | boolean | `false` | skip your own edits and deletes                                                           |
| `ignoreAnchors` | select  | `off`   | `off` \| `lax` (skip all bot-sent deletions) \| `strict` (skip pinned bot-sent deletions) |

`deletedStyle` can be `liveSettings` (it is only CSS). The two ignore options
change what gets captured, so restarting the plugin on change is simpler and
safe.

---

## Shape of the v2 plugin

```ts
start() {
  // capture
  this.api.rtm.on('message_deleted', (event) => this.record(event));
  this.api.rtm.on('message_changed', (event) => this.record(event));

  // re-insert, both slices, via the shared helper
  this.api.messages.injectMessages(() => this.stored.values());

  // style + the "edited" affordance
  this.api.setStyle(css(this.config.deletedStyle), 'deleted');
  this.api.patchComponent('MessageWrapper' | 'ThreadRootGeneric', ...);
}
```

The row patch is `MessageWrapper` (channel) and `ThreadRootGeneric` (thread
parent), the same names Taut's ShowRealUser wraps with `props.msg`. If Slack
renames them, deleted messages still reappear (`injectMessages` does not depend
on the component) but the red/opacity style and edit history go inert; the
plugin logs a warning if neither has rendered after 20s. Update
`docs/slack-internals.md` when that happens.

Persistence goes through `api.storage` (plugin-scoped, enumerable, survives
correctly) rather than `localStorage`. The log is capped at 1,000 entries.

---

## Verification

1. Focused window on an open channel. Have someone delete a message: it stays
   visible, styled per `deletedStyle`.
2. Have someone edit a message: the previous version is reachable.
3. Reload: logged messages survive (they are in `api.storage`, not memory).
4. Switch channels and come back: injected messages still render — this is the
   check that actually exercises the `channelHistory` patch.
5. Threads: a logged reply appears in the thread view, and does **not** leak
   into the channel view unless it was a broadcast.
6. Disable the plugin: injected messages disappear and Slack's own view is
   intact, with no reload.
7. `getRawState().messages[ch][ts]` must be unchanged — Slick transforms on
   read and never mutates Slack's state.
