# Handoff: NotShitMarkdown

**Status:** not ported. v1 lives at `plugins/NotShitMarkdown/{index.js,renderer.js}`
(12 + 629 lines).

**What it does:** lets you type normal Markdown in the composer — `**bold**`,
`__underline__`, `~~strike~~`, `` `code` ``, `[text](url)` — and sends it as
the Slack rich text Slack would have produced.

Read `PORTING.md` first.

---

## Why it is being rewritten

v1 intercepts the outgoing HTTP request. It patches `fetch` and
`XMLHttpRequest`, matches `/api/chat.(postMessage|update|scheduleMessage)`,
pulls the `blocks` JSON back out of the serialized body, re-parses it, rewrites
the `rich_text` elements and re-serializes.

That is three layers of guessing: it has to detect that a request is a message
send, it has to reverse Slack's serialization, and it has to reconstruct block
structure Slack already had in hand a moment earlier.

**v2 transforms the Quill Delta before Slack ever converts it.**
`api.onMessageSendDelta` is already built and already patches all three
composer components (`MessagePaneInput`, `InputContainer`, `BaseEditMessage`).
The whole integration is:

```ts
start() {
  this.api.onMessageSendDelta((delta) => transform(delta, this.config));
}
```

Everything else is a pure function over a Delta — which is the good news,
because it is testable without Slack.

---

## What a transform actually does

A Delta is `{ ops: [{ insert, attributes? }, …] }`. Slack's composer represents
formatting as Quill attributes on the inserted text: `bold`, `italic`,
`strike`, `code`, `link`, and Slack's own `code-block`.

So the job is: for each `insert` op whose value is a **string**, parse the
Markdown in it and split it into several ops carrying the equivalent
attributes. `**bold**` becomes `{insert: 'bold', attributes: {bold: true}}`.

Rules that matter:

- **Only string inserts.** An `insert` that is an object is an embed — a
  mention, an emoji, a file, a broadcast. Pass those through untouched. A
  mention rewritten as text stops being a mention.
- **Preserve existing attributes.** Someone can type `**bold**` inside text
  they already marked italic with Cmd-I. Merge, do not replace.
- **Do not format inside code.** Text already carrying `code` or `code-block`
  is literal; `**` inside it stays `**`.
- **Escapes.** `\*` is a literal asterisk. v1 handles this in `pushText` with
  `replace(/\\([\\`*_~[\]()])/g, '$1')`; carry that behaviour over.
- **Emphasis boundaries.** `snake_case_name` must not become italic. v1's
  `canOpenEmphasis` / `canCloseEmphasis` encode the rule: `_` may not open
  after a word character, and a marker may not open before whitespace. Port
  those two functions and their tests rather than re-deriving them.
- **Longest marker first.** `**` before `*`, `__` before `_`, or `**bold**`
  parses as two empty italics.
- **Return a real Delta.** The `Delta` type carries a private brand precisely
  to stop `{ ops: [...] }` satisfying it. Slack calls methods on the object it
  gets back, so build the result with the constructor
  (`api.blocks.makeDelta(ops)`) rather than an object literal.

---

## Settings

v1 declares none. The port should add them, because the parser has genuinely
contentious cases:

| key | type | default | notes |
| --- | --- | --- | --- |
| `bold` | boolean | `true` | `**text**` |
| `italic` | boolean | `true` | `*text*` and `_text_` |
| `strike` | boolean | `true` | `~~text~~` |
| `code` | boolean | `true` | `` `text` `` |
| `links` | boolean | `true` | `[text](url)` |

All five are `liveSettings`: they only change how the next message is parsed,
and the transform reads `this.config` on each call.

---

## Structure

```
src/plugins/NotShitMarkdown/
  meta.ts
  markdown.ts        the parser: (text, active attributes, config) -> ops[]
  markdown.test.ts   node --test, no Slack required
  index.ts           ~30 lines: register the transform
```

Put the parser in its own module and test it properly. It is a text parser with
a dozen edge cases and it is the entire risk of this plugin; it should not need
a running Slack to change with confidence.

Add `src/plugins/NotShitMarkdown/markdown.test.ts` to the `test:app` glob in
`package.json`.

### Cases the tests must cover

- each marker, alone and nested (`**bold *and italic***`)
- `snake_case_identifier` stays plain
- `a * b * c` stays plain (space after the opening marker)
- `\*literal\*` renders the asterisks and no emphasis
- backtick spans suppress everything inside them
- an existing `code-block` op is returned identically
- an object insert (mention, emoji) is returned identically, by reference
- an op that contains no Markdown is returned **by reference**, not copied —
  this is what keeps the transform cheap on the common case
- a link whose URL contains `)` — decide the behaviour and pin it

---

## Verification

1. Type `**bold**` and send: the message shows bold, and the composer shows
   what you typed until you send.
2. Type `**bold**` inside a code block: it sends literally.
3. Type a mention followed by `**bold**`: the mention survives and still
   resolves.
4. Edit an existing message and add `~~strike~~`: the edit path
   (`BaseEditMessage`) is patched too, so this must work.
5. Turn `italic` off in settings while running: `*text*` sends literally, with
   no restart.
6. Disable the plugin: Markdown is sent literally again, no reload.
