# Handoff: PrivateChannelMapper

**Status:** not ported. v1 lives at `plugins/PrivateChannelMapper/{index.js,renderer.js}`
(24 + 469 lines).

**What it does:** names the private channels Slack will not name for you, and
lets you `#mention` ones you are not in. Names come from the Flaron index
(`https://flaron.halceon.dev`).

Read `PORTING.md` first.

**Reference implementation:** Taut's `plugins/PrivateChannel.tsx` (447 lines,
MIT, github.com/jeremy46231/taut). Same feature, same index, same
architecture — this is close to a direct port. Attribute what you lift.

---

## Settings (port verbatim from v1)

| key        | type    | default | notes                                                    |
| ---------- | ------- | ------- | -------------------------------------------------------- |
| `flaron`   | boolean | `false` | show known private channel names when Slack has none     |
| `mentions` | boolean | `false` | autocomplete `#channel` for private channels Slack hides |

Both default **off**, and both should stay off. `mentions` in particular sends
the name you typed to a third-party service to look up — the setting
description says so and must keep saying so.

Both change what the plugin subscribes to and fetches, so neither is a
`liveSettings` key; a restart on change is correct here.

---

## Mechanism

`redux.patchSlice('channels', …)` layered over Slack's own cache, plus
`channels.makeChannelObject` (already in `src/app/slack/channels.ts`) to build
channel objects Slack will accept.

`makeChannelObject` matters for the same reason `modifyMemberObject` does: a
synthesized channel has to carry the denormalized name fields
(`name_normalized`, `_name_lc`, `previous_names`) or autocomplete and search
will not match it.

Taut's structure, worth keeping:

- **`index`** — every channel Flaron knows a name for. Flaron reports
  `private: true` for public channels too, so these are **names only** and must
  never stand in for a channel Slack could fetch itself.
- **`shadows`** — channels confirmed inaccessible, layered on Slack's cache,
  with a 24h TTL so a channel that has since gone public (or that you joined)
  gets resolved by Slack again.
- **`synthesized`** — a `WeakSet` of the channel objects the plugin built, so
  it can tell its own reads from Slack's.

Cadence: re-pull the full export at most every 6 hours; cap how many index
entries one autocomplete query may check against Flaron (Taut uses 5).

---

## Traps

**This plugin talks to a third party.** Every request tells Flaron something
about what this user is looking at. Keep requests to the minimum the feature
needs, keep both settings off by default, and never send anything beyond a
channel id or the name the user typed. It must never send the user's identity,
token, or workspace.

**Requests go through `api.fetch`**, not the page's `fetch` — cross-origin from
the Slack page otherwise.

**Never let a synthesized channel shadow a real one.** If Slack can resolve a
channel itself, Slack wins. The `synthesized` WeakSet exists for exactly this.

**Cache to `api.storage`, on a debounce.** The index is large; do not write it
on every mutation and do not hold two copies.

**Degrade to nothing.** Flaron unreachable, slow, or returning nonsense means
the plugin shows Slack's own behaviour. It must never block a render or leave a
spinner on a channel name.

---

## Verification

1. Both settings off (the default): Slack behaves exactly as stock. This is the
   most important check — it is the state almost every user is in.
2. Turn `flaron` on: a private channel Slack shows as an ID gets a name.
3. Turn `mentions` on: `#` autocomplete offers a private channel you are not
   in, and mentioning it produces a working link.
4. Block the network: no spinner, no error dialog, no unnamed-channel
   regression versus stock Slack.
5. A channel you actually joined resolves through Slack, not through the
   shadow cache — confirm by joining one and watching the name source change.
6. Disable the plugin: every synthesized name disappears, no reload.

---

# Part 2: finishing the port

**Status of part 1 (done):** `meta.ts`, `flaron.ts` (+ tests), `main.ts` (the
Flaron RPC, `net` capability) and `index.ts` (the `channels` patchSlice that
supplies names). Names resolve. What is missing is everything behind the
`mentions` setting, plus the rendering of channels Slack cannot see.

`index.ts` currently logs `mention autocomplete is not ported yet` when
`mentions` is on. That log goes away when this is done.

## What is left

### 1. Autocomplete (`mentions`)

Two thunk patches. Taut's `plugins/PrivateChannel.tsx` lines ~310-360 is the
reference and is worth reading closely, because the tiering is not obvious.

**`autocompleteChannels`** — the composer passes the typed text with its sigil
still attached, so strip a leading `#` and lowercase before using it.

Slack's autocomplete returns **two tiers**: the thunk resolves to a local
array, and that array carries a `.promise` property resolving to the remote
tier (which also includes the local results). Both have to be respected:

1. await the remote tier
2. if it already contains an **exact** name match, return it untouched — no
   Flaron request at all
3. otherwise ask Flaron for that name (`api.main.call('byName', name)`), and if
   it resolves, put the channel into the store
4. re-run the **original** thunk so Slack's own matching logic finds what was
   just added, and merge those results in. Do not await the re-run's remote
   tier; the first pass already populated the store

Step 2 is the privacy-relevant one: it is what stops every keystroke becoming a
third-party lookup.

**`fetchRawChannelsById`** — the response carries a `missing` array of ids
Slack could not fetch. Those are the confirmed-inaccessible channels, and they
are what makes a shadow trustworthy rather than a guess. Record them.

### 2. Rendering channels Slack cannot see

Two component patches, replacing v1's label-text-node rewriting:

- **`BaseMrkdwnChannel`** — an inline `#channel` mention. Inaccessible when
  `isNonExistent`, `isUnknown`, or (`isPrivate` and not `isMember`).
- **`ListChannelEntity`** — the same channel in a list. The props carry only an
  `id`, so read the channel out of the store with `redux.useReduxState`.

Both render the known name in place of the id when the channel is one Slick
named. Keep it visually distinguishable from a channel Slack itself resolved —
v1 used a `slick-pcm--flaron` class for exactly this, and it matters: a name
from a third-party index is not the same claim as a name from Slack.

### 3. Shadow TTL

A confirmed shadow should expire (Taut uses 24h) so a channel that has since
gone public, or that you have joined, goes back to being resolved by Slack.

## Traps

**`candidatesFor` in `flaron.ts` is already written and tested** — use it. It
ranks exact, then prefix, then substring, and caps the number of lookups.

**Do not let a synthesized channel shadow a real one.** `index.ts` already
guards this with `slackKnowsName`; keep that rule in the new paths too.

**Every Flaron request tells a third party something about what this user is
looking at.** Step 2 above is not an optimization, it is the privacy design.
Keep both settings off by default, and never send anything beyond a channel id
or the name the user typed.

## Verification for part 2

1. `mentions` off (the default): typing `#` behaves exactly like stock Slack,
   and **no** request is made to Flaron. Check that.
2. `mentions` on: type the name of a private channel you are not in. It
   appears in the autocomplete and inserts a working mention.
3. Type a channel Slack _can_ see: no Flaron request is made, because Slack
   already had an exact match.
4. A mention of an inaccessible channel renders its name, visibly distinct
   from one Slack resolved itself.
5. Block the network: autocomplete still works for everything Slack knows, with
   no spinner and no error dialog.
6. Disable the plugin: every synthesized name disappears, no reload.
