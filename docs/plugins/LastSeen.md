# Handoff: LastSeen

**Status:** not ported. v1 lives at `plugins/LastSeen/{index.js,renderer.js}`
(43 + 609 lines).

**What it does:** shows a "last seen" time on someone's profile, built only
from what this client can observe — Slack exposes no last-seen API.

Read `PORTING.md` first.

**Reference implementation:** Taut's `plugins/LastSeen.tsx` (255 lines, MIT,
github.com/jeremy46231/taut) solves the same problem on the same architecture.
Read it. Attribute anything lifted.

---

## Where the data comes from

Two independent sources, each behind its own setting:

**1. Observed activity (`showObservedPresence`).** Every RTM event that implies
someone was at their keyboard, recorded with its timestamp:

| event | who it implies |
| --- | --- |
| `presence_change` | `users` or `user`, **only when `presence === 'active'`** |
| `user_typing` | `user` |
| `message` | `user`, unless a bot posted under it |
| `reaction_added` | `user` |

The `presence_change` rule is the one that bites: an `away` batch arrives in
bulk when you subscribe, so treating `away` as an observation records "last
seen: now" for everyone in the workspace at once. Only `active` means now.

Bot-sent messages need filtering too — a bot posting with a user token carries
a real `user` alongside `bot_id`/`app_id`. Taut's `human()` helper is the
check.

**2. Last visible message (`showLastMessage`).** `search.messages` through
`api.userAPI`, scoped to the person, most recent first. Cached — this is a
rate-limited API and a profile can be opened repeatedly.

---

## Settings (port verbatim from v1)

| key | type | default | notes |
| --- | --- | --- | --- |
| `showLastMessage` | boolean | `true` | look up their most recent visible message |
| `showObservedPresence` | boolean | `true` | show when they were last observed active |
| `trackWatchlist` | boolean | `false` | subscribe to presence for profiles you open; costs websocket traffic |
| `cacheTtlHours` | number | `168` | how long cached lookups and observations live |

`showLastMessage` and `showObservedPresence` are display-only, so `liveSettings`.
`trackWatchlist` changes what the plugin subscribes to — simpler to restart.

---

## Traps

**Storage must be bounded.** Observations are one entry per person the client
ever sees, on a busy workspace, forever. Taut caps at `MAX_SEEN = 2000` and
prunes on a 15s timer. v1 grew without limit. Cap it and evict oldest-first;
`cacheTtlHours` bounds age but not count.

**Write to disk on a timer, not per event.** `user_typing` alone can fire
several times a second across a workspace. Keep observations in memory and
flush through `api.storage` on an interval and in `stop()`.

**The search API is rate limited.** One request per profile open, cached with
`api.Cache`, and never on a render path. `api.userAPI` takes
`rateLimitRetries`; use it.

**`trackWatchlist` defaults off for a reason.** It sends presence subscriptions
for everyone whose profile you open. Keep the default, and keep the setting
description honest about the cost.

**Anything shown must degrade.** If there is no observation and no message, the
plugin renders nothing — not "never", which is a claim it cannot support.

---

## Where it renders

The profile pane and the hover card. Taut patches `MemberProfile` /
hover-card components and the presence line; the exact `displayName`s in
Slack 4.52.155 are **not yet confirmed** for Slick and need a discovery pass
(`getRenderedComponent`, `waitForRenderedComponent`, the debug globals on
`globalThis`). Record whatever you find in `docs/slack-internals.md`.

If a component name cannot be found, render nothing and log once. A profile
pane that fails to open is far worse than a missing line on it.

---

## Verification

1. Open a profile: a last-seen line appears, or nothing appears — never a
   broken or "Invalid Date" line.
2. Watch someone type in a channel, then open their profile: the observed time
   is recent.
3. Reload: observations survive (they are in `api.storage`).
4. Leave it running an hour on a busy workspace, then check the stored size is
   still bounded.
5. Turn `showLastMessage` off while running: the message line goes, no restart.
6. Disable the plugin: the profile is exactly Slack's again, no reload.
