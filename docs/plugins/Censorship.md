# Handoff: Censorship

**Status:** ported. Lives in `src/plugins/Censorship/`. Masking is pure
(`censor.ts`) so it can be tested without Slack; the plugin itself is a
two-level `messages` patch plus a `MessageListItem` search patch.

**What it does:** masks configured words in message bodies and search results,
on this client only. "There is no war in Ba Sing Se."

**v1 source (still on `main`):** `plugins/Censorship/{index.js,renderer.js}`
(52 + 241 lines).

---

## Why it is being rewritten

v1 subscribes to the shared MutationObserver hub and rewrites text nodes as
Slack renders them. Two consequences: the uncensored word is on screen for a
frame before it is masked, and the cost scales with everything Slack renders
rather than with the number of messages.

v2 masks the message **before React ever sees it**, by transforming the redux
`messages` slice on read. Nothing uncensored is rendered, and the cost scales
with messages actually read.

---

## Trap, read this first

`state.messages` is nested **two levels deep**: `messages[channelId][ts]`.

```ts
// WRONG -- `entry` is a channel bucket, not a message. Compiles, runs,
// does nothing at all.
api.redux.patchSlice('messages', (id, message) => censor(message));

// RIGHT -- map the bucket, then each message inside it
api.redux.patchSlice<object>('messages', (channelId, bucket) => {
  if (!bucket || typeof bucket !== 'object') return bucket;
  return api.redux.mapEntries(bucket, (ts, message) => censor(message));
});
```

Taut's `plugins/ShowRealUser.tsx` is the reference for this pattern, and
`app/slack/messages.ts` (`getRawMessage`) confirms the shape.

**Second trap:** in an unattended `npm run desktop:dev` run the window is never
focused and `state.messages` stays empty for the whole session — along with
`channels`, `members` and `view`. An empty slice there means the client never
loaded a conversation, not that the slice is unused. Test with a focused window
on an open channel. See `docs/slack-internals.md`.

---

## Implementation sketch

Settings schema is already ported verbatim from v1 — reuse it as
`src/plugins/Censorship/meta.ts`:

| key               | type    | default           | notes                                         |
| ----------------- | ------- | ----------------- | --------------------------------------------- |
| `terms`           | text    | `job, employment` | comma separated                               |
| `style`           | select  | `stars`           | `stars` \| `hashtags` \| `blocks` \| `custom` |
| `replacement`     | text    | `uwu`             | used when `style` is `custom`                 |
| `keepFirstLetter` | boolean | `false`           |                                               |
| `keepLastLetter`  | boolean | `false`           |                                               |

Masks: `stars` → `*`, `hashtags` → `#`, `blocks` → `█`.

All five keys belong in `liveSettings` — they only change how text is
rewritten, so no restart is needed.

```ts
static readonly liveSettings = ['terms', 'style', 'replacement', 'keepFirstLetter', 'keepLastLetter'];

onSettingsChange() {
  this.compile();       // rebuild the RegExp
  this.api.redux.refresh();   // REQUIRED, see below
}
```

**`api.redux.refresh()` is not optional.** `mapEntries` memoizes per entry and
keys the memo on the patch version. Without a refresh, the closure keeps
serving results computed from the old settings and the plugin looks like it
ignores its own configuration.

### What to censor in a message

`text` alone is not enough. Slack renders from `blocks` when present and falls
back to `text`, and forwarded content lives in `attachments`. Walk all three,
rewriting every string and leaving the structure untouched. A recursive
`censorDeep` over strings/arrays/objects is sufficient and was already written
in the deleted attempt — recover it from git history if useful:

```
git show 2f49f9b^:src/plugins/Censorship/index.ts
```

Build the term matcher as one alternation with `\b` anchors and escape the
terms (`/[.*+?^${}()|[\]\\]/g`), so a term containing regex metacharacters
cannot blow up or match wildly.

---

## Scope (decided)

v1 censored **rendered text anywhere**, including channel names, the sidebar
and search results. v2 is narrower:

- **Message bodies** — yes. Two-level `messages` patch. This is the rewrite.
- **Search results** — yes. `MessageListItem` (`props.result.messages`), the
  same component Taut ShowRealUser uses, because search keeps its own copies
  that never pass through `messages`.
- **Channel names** — no. Needs `channels` field knowledge (`name` /
  `purpose.value` / `topic.value`) that a display-string walk does not have,
  and a wrong key is a silent miss.
- **Member display names** — no. Taut's `modifyMemberObject` also rewrites
  derived name fields (`_display_name_lc`, …). That helper is not in v2 yet;
  Nicknames will want it. Patching `profile.display_name` alone would leak
  on other surfaces.

Drafts are not in `messages`, so the composer is left alone. Code in a
message body is masked: the product is hiding the word, not preserving
snippets that contain it.

---

## Verification

1. Focused window, open a channel containing a term.
2. The term is masked on first paint — never visible then replaced.
3. Change `terms` in `settings.json` while running: the masking updates without
   the plugin restarting (`[slick] Censorship applied live settings: terms`).
4. Disable the plugin: original text returns immediately, no reload.
5. Confirm `getRawState().messages[ch][ts].text` is still the **uncensored**
   original — Slick transforms on read and must never mutate Slack's state.
