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

| key | type | default | notes |
| --- | --- | --- | --- |
| `flaron` | boolean | `false` | show known private channel names when Slack has none |
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
