# Handoff: BetterCaptions

**Status:** not ported. v1 lives at `plugins/BetterCaptions/{index.js,renderer.js}`
(282 + 172 lines). **Windows only.**

Read `PORTING.md` first.

**What it does:** captures huddle system audio, sends it to a
Whisper-compatible transcription API, and shows the result as captions.

---

## Why it is Windows only

It captures *system* audio, which Electron only supports through
`setDisplayMediaRequestHandler` with a loopback audio source — and that path is
Windows-only (`index.js:102` refuses anything else outright). A
`main.ts` that declines to activate on macOS and Linux **must not be an
error**: Preferences needs a per-platform "unavailable" state, and this is the
plugin that proves it.

---

## Settings (port verbatim from v1)

| key | type | default | notes |
| --- | --- | --- | --- |
| `provider` | select | `openai` | `openai` \| `xai` \| `custom` |
| `apiKey` | text | `''` | **a credential** |
| `endpoint` | text | `''` | custom provider only; must be HTTPS |
| `model` | text | `whisper-1` | |
| `language` | text | `''` | ISO-639-1, blank auto-detects |
| `mode` | select | `normal` | `normal` \| `australian` |
| `transformModel` | text | `gpt-4o-mini` | text model for the fun modes |
| `segmentSeconds` | number | — | see v1 |

All were `restartRequired` in v1. In v2 that maps to leaving them out of
`liveSettings`, which restarts the plugin on change — correct here, since the
capture pipeline is stateful.

---

## Architecture

**Main half.** Capabilities: `media` (the display-media handler) and `net`
(the transcription API is cross-origin).

- `ctx.media.onDisplayMediaRequest` replaces v1's direct
  `setDisplayMediaRequestHandler`, which fought with anything else wanting it.
- v1 verified the requesting origin before granting capture (`index.js:120`).
  **Keep that.** It is the check that stops any page in the client from
  silently capturing system audio.
- Two RPC methods, replacing v1's fake `https://slick.better-captions/capture`
  and `/transcribe` hostnames: `capture()` and `transcribe(buffer)`. The result
  is the promise's value, which deletes v1's `CustomEvent` round-trip and its
  audio-smuggling through `session.getBlobData`.

**Renderer half.** Records segments, calls `api.main.call('transcribe', …)`,
renders captions. The huddle container component is **not identified yet**;
find it in a discovery session, or fall back to a DOM-anchored overlay, which
is what v1 does and is acceptable here.

---

## Traps

**`apiKey` is a credential in the settings file.** It must never be logged, and
it must never be sent anywhere but the configured provider. The custom endpoint
must be HTTPS and must be validated before use — a `http://` or attacker-set
endpoint turns this into an audio exfiltration tool. Validate in the **main**
half, not the renderer.

**Audio leaves the machine.** That is the feature, but it should be obvious to
the user that it is happening, and capture must stop when the huddle ends — not
merely stop being displayed. Check the tracks are actually released.

**Do not let the renderer name the endpoint.** Same rule as AdminBackend: the
renderer asks for a transcription, the main half decides where that goes.

**`transformModel` sends caption text to a second API.** The `australian` mode
is a joke, but it is a joke that posts transcribed private conversation to a
chat-completions endpoint. Keep it behind the explicit `mode` setting and keep
`normal` the default.

---

## Verification

Needs a Windows machine; the VM is reachable at `ssh slickvm` (see the
`slick-windows-vm` notes).

1. macOS and Linux: the plugin is listed as unavailable, does not error, and
   does not appear broken.
2. Windows, in a huddle: captions appear.
3. Stop the huddle: capture actually stops — check the audio tracks are ended,
   not just hidden.
4. Bad API key: one clear error, no retry storm, no key in the log.
5. Custom provider with an `http://` endpoint: refused.
6. Disable the plugin: capture stops immediately.
