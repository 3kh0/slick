# Early injection: implementation guide

This guide records how to extend and validate Slick's early-injection runtime. Keep it aligned with the code and distinguish live observations from assumptions about Slack internals.

The runtime is shared by three hosts: a Chrome MV3 extension, an opt-in Electron preload wired into the desktop BYOE loader, and the Node/Electron test harnesses. See the [beta guide](beta.md) for source installation on all three platforms, browser loading, rollback, and the live test checklist. Normal installation remains stable; `--beta` (`-Beta` in PowerShell) enables the installed runtime through its root `.slick-beta` marker. Source installation also marks the checkout; reinstallation without the switch removes the markers without purging profile settings.

The early registry covers the desktop plugin catalog except `QuietSpotify`, which can only inject into cross-origin Spotify frames from the Electron main process (see [Ported plugins](#ported-plugins)). Capability checks select early behavior per plugin per document; an unsupported or failed early hook must leave that plugin's legacy behavior available, without duplicate patches. Desktop `main()` continues to run for privileged work (custom protocols, `shell.openExternal`, screen-share detection, transcription).

## Architecture and scope

Slick's shipped `scripts/byoe/inject.js` initializes renderer plugins at `dom-ready`. Its internals bridge expects Slack's module loader to exist already. Replacing an export — or `window.fetch`, or `WebSocket.prototype.send` — at that point cannot update references captured earlier.

The early runtime installs interception before Slack executes its first scripts:

1. The browser extension uses a static `document_start`, `MAIN` content script.
2. Desktop registers a renderer preload using `session.registerPreloadScript`, then executes the same bundled code with `contextBridge.executeInMainWorld`.
3. The runtime observes `webpackChunkwebapp` and `rspackChunkwebapp`, wraps module factories, and patches selected exports as those modules naturally finish initializing.
4. Plugins transform component props, project local state, rewrite text through one shared pass, or intercept outgoing requests. They do not force-require modules to discover them.
5. Platform adapters supply settings and any data a plugin cannot fetch itself. The page never receives filesystem, arbitrary network, cookie, or extension-management APIs.

Keep Slack's original document and CSP. No document reconstruction, script replay, runtime `eval`, or remotely downloaded plugin code is needed. The `.toString()` calls in the Node build produce a static JavaScript bundle; the browser does not compile source strings at runtime.

### Related implementations

- [Rope](https://github.com/anirudhb/rope): module, React, and Redux wrapping; inspect `src/patch.ts`. The researched userscript loader reconstructed Slack's document.
- [Taut](https://github.com/jeremy46231/taut): shared app with multiple loaders; inspect `app/slack/webpack.ts`, `app/slack/react.tsx`, and `app/slack/members.ts`. Its researched Chrome loader reconstructed the document and removed CSP restrictions.
- [Snail](https://github.com/espcaa/snail): another Slack mod, documented as macOS-only when researched.

Those are useful references, not stable specifications. Verify upstream code before adopting a mechanism. Browser support and early internal hooks do not make Slack's private APIs stable.

## Source layout

| Path                                   | Responsibility                                                                      |
| -------------------------------------- | ----------------------------------------------------------------------------------- |
| `runtime/early.js`                     | Module interception, component wrapping, shared style/DOM/text/network capabilities |
| `runtime/registry.js`                  | The ordered plugin descriptor list the bundle carries                               |
| `runtime/bundle.js`                    | Descriptor serialization, bundle source, options-page metadata                      |
| `runtime/plugins/*.js`                 | One descriptor per ported plugin                                                    |
| `extension/manifest.json`              | Static MAIN and ISOLATED content scripts, options page, rules service worker        |
| `extension/bridge.js`                  | One-way extension storage → page settings                                           |
| `extension/rules.js`                   | Fetches ClearURLs provider rules in the extension world                             |
| `extension/options.*`                  | Settings UI generated from the built plugin metadata                                |
| `scripts/early/build.js`               | Produce `dist/early-extension`                                                      |
| `scripts/early/desktop.js`             | Register the opt-in Electron preload                                                |
| `scripts/byoe/early-settings.js`       | Map desktop settings onto the runtime and gate activation per plugin                |
| `scripts/early/runtime.test.js`        | Module, component, settings, capability, and plugin regression tests                |
| `scripts/early/desktop.test.js`        | Preload registration, IPC validation, and settings-adapter tests                    |
| `scripts/early/fake-dom.js`            | Minimal DOM for Node tests of the text, element, and style hubs                     |
| `scripts/early/test-electron.js`       | Launch the real Electron fixture tests                                              |
| `scripts/early/electron-fixture.js`    | Native preload, CSP, composer layout, and ported-plugin assertions                  |
| `scripts/early/fixtures/composer.html` | Offline page with strict CSP and restored composer content                          |
| `scripts/early/fixtures/plugins.html`  | Offline page with messages, a draft, and a composer for the ported plugins          |

The build generates `main.js`, `plugins-meta.js`, `desktop-preload.cjs`, and the extension files under `dist/early-extension`. `dist/` is ignored. Rebuild after editing runtime code, the registry, or any legacy plugin whose schema or CSS the descriptors reuse.

## Plugin descriptors

A plugin is a plain object in `runtime/registry.js`:

```js
{
  id: 'Censorship',          // the legacy plugin directory name; also the settings key
  description: '…',
  defaultEnabled: false,     // activation when a config omits this plugin
  settings: { … },           // schema; `enabled` is reserved for activation
  assets: { css: '…' },      // build-time data (JSON-able)
  probe: (diagnostics) => …, // optional; defaults to diagnostics.installed[id] === true
  setup: function setup(api) { … },
}
```

`setup` and `probe` are emitted through `Function.prototype.toString`, so **they must be self-contained**: module scope does not exist in the page. Anything a plugin needs from Node — a legacy plugin's settings schema, its CSS — belongs in `assets` or in the descriptor's data fields, which are serialized as JSON. `runtime/bundle.js` rejects method-shorthand functions, which are not valid expressions on their own.

Reusing the legacy plugin's own `settings` and `css` (as SlimMessageBox, Snappy, Censorship, ClearURLs, and CustomFonts do) keeps the desktop settings UI and the early runtime from drifting apart. It also means a descriptor may `require` from `plugins/`; that directory is copied into the runtime root before `scripts/release/beta.js` builds the payload on all three platforms.

### Settings and activation

Configuration is a single shape:

```js
window.__slickEarly.configure({
  enabled: true, // global switch
  plugins: {
    Nicknames: { enabled: true, names: { U0123456789: 'Local name' } },
    Censorship: { enabled: true, terms: 'job', style: 'stars' },
  },
});
```

The original two-plugin prototype keys (`nicknames`, `slim`) are still accepted and mapped onto `Nicknames` and `SlimMessageBox`.

`configure` normalizes everything through each plugin's schema: unknown keys are dropped, and values are coerced by `type` (`boolean`, `number` with `min`/`max`, `text` with `maxLength`, `select` against `options`, `names`, or a schema-supplied `coerce`). A plugin absent from `plugins` falls back to `defaultEnabled`; a plugin present is active unless `enabled: false`. The global switch overrides both. Because coercion is central, a plugin never has to validate its own settings, and hostile input from a platform adapter cannot reach a plugin as an unexpected type.

Settings are asynchronous. Install interception first and apply settings when they arrive; do not promise that persisted nicknames are visible on the very first paint. Notify a snapshot of subscribers so synchronous unsubscribe/resubscribe cannot extend a notification loop.

Direct `configure` calls are in-memory and disappear on navigation. The browser options page writes `chrome.storage.local`; the isolated content script sends the current configuration and subsequent changes to the page. No page-to-extension privileged RPC is exposed. Page-origin scripts can influence the in-page configuration, so this is not a security boundary between Slick and Slack's own JavaScript.

### The plugin API

`setup(api)` receives a scoped API. Everything on it is already gated on that plugin's activation.

| Member                      | Purpose                                                                               |
| --------------------------- | ------------------------------------------------------------------------------------- |
| `api.settings`              | Coerced settings, including `enabled`                                                 |
| `api.enabled`               | Global switch and this plugin's activation                                            |
| `api.version`, `subscribe`  | Settings generation and change notifications                                          |
| `api.assets`                | Build-time data from the descriptor                                                   |
| `api.installed(ok)`         | Self-report whether the plugin's hook actually installed; feeds the default probe     |
| `api.count(name, n)`        | Diagnostic counters, reported as `Plugin.name`                                        |
| `api.fail(error)`           | Record an error against this plugin                                                   |
| `api.component(name, fn)`   | Transform an inner component's props                                                  |
| `api.onExports(fn)`         | Inspect or replace a module's exports as it initializes                               |
| `api.trackStore(store)`     | Register a Redux store for refresh on settings changes                                |
| `api.style(id)`             | A managed `<style>` element; `.set(css)`                                              |
| `api.dom.roots/elements`    | Subscribe to the shared MutationObserver                                              |
| `api.text(fn)`              | Join the shared text pass                                                             |
| `api.net.request/socket`    | Intercept outgoing requests and websocket frames; returns whether the patch installed |
| `api.fiber.of/walk/closest` | Climb a node's React fiber for `memoizedProps` without each plugin reimplementing it  |
| `api.ready(fn)`             | Run once `document.documentElement` exists                                            |

## Runtime contracts

### Module interception

Install synchronously, before waiting for storage or network. Hook both supported chunk globals. An early hook must survive Slack replacing the array's `push` function.

Each replacement push must close over its own original function. A single mutable original shared by every wrapper recurses when Slack's replacement calls a previously captured push. Factory wrappers are deduplicated with a WeakMap.

Preserve factory `this`, arguments, synchronous completion, original exceptions, circular module access, and return value. Run export hooks only after the original factory returns. Catch plugin initialization, export-hook, and props-transform failures independently so a plugin failure does not prevent Slack from loading.

The wrapper's `.toString()` exposes the original factory source for callers using that method. **`Function.prototype.toString.call(wrapper)` still returns the wrapper source.** Any future source-signature adapter must retain original factory references explicitly; do not assume overriding `.toString()` changes the intrinsic.

`diagnostics().late` indicates that a chunk array existed when installation started. Normal full-page startup should report `false`; late injection cannot retroactively repair references already captured by Slack.

### React and JSX wrapping

Recognize React exports by `createElement`, `Component`, and `forwardRef`; recognize JSX-runtime exports by `jsx` and `jsxs`. The `react` diagnostic counts distinct observed export objects, not proven independent React installations.

`api.component(displayName, transform)` transforms the inner named component's props. Several plugins may register the same name; transforms run in registry order, each skipped while its own plugin is inactive, and each failing independently. Cache wrappers **per original element creator** and component type. Return elements through that captured creator, never through whichever React export was discovered most recently.

Wrappers use a class subscription and `forceUpdate`, with a `forwardRef` shell:

- Subscribe in `componentDidMount`; unsubscribe in `componentWillUnmount`.
- Recheck the settings version at mount to cover a change between render and commit.
- Transform props in `render`, preserving the original props when disabled or when the transform throws.
- Forward refs to the original component, not the subscription wrapper.
- Use no hooks in the wrapper. React 19 production JSX runtimes need not import React, so guessing an owning hook dispatcher from the last loaded module is unsafe. The public class updater supplied by the renderer avoids that dependency.

Unmatched component types retain their identity. Matched wrappers remain mounted when the prototype is disabled, but pass through the original behavior; a full reload removes the interception itself.

Do not also wrap `Connect(Name)` with the same transform. The connected component may overwrite the props you supplied while merging its state props. Patch the inner component after that merge.

### Shared styles

`api.style(id)` returns a handle over one `<style>` element. Styles requested before `document.documentElement` exists are held and flushed once it does. Setting empty CSS keeps the element and empties it, which is what the tests and the desktop fallback check. Give the element a stable id: `#slick-early-composer`, `#slick-early-snappy`, `#slick-early-fonts`.

### The shared DOM hub

There is exactly one `MutationObserver`, on `document.documentElement`, for every plugin. Plugins must not create their own document-wide observers: repeatedly walking Slack's tree from several observers is the main cost of the legacy renderer plugins. `characterData` is enabled only while some subscriber asks for it, and the observer is re-observed when that changes.

Hooks receive `(added, removed, targets)`. `targets` carries the mutation record targets, so a plugin can react to a _removal_ without re-walking the document — SlimMessageBox uses it to re-measure only the composer a mutation actually touched. Hooks are skipped while their plugin is inactive, so toggling a plugin never adds or drops observers.

Scoped observers are still appropriate where the plugin owns a small element and needs geometry: SlimMessageBox keeps a per-composer `ResizeObserver`. The goal is to avoid repeatedly rewriting Slack's data-driven UI, not to forbid DOM APIs where measurement is necessary.

### The shared text pass

`api.text(fn)` joins one pass over text nodes. The runtime owns the bookkeeping; the transform stays pure, receives the **pre-transform** text, and returns the replacement.

The convergence property matters. The runtime remembers the value it last wrote for a node: if the node still holds that value, the recorded original is reused; otherwise the current value becomes the new original. Re-running therefore reproduces the same output and performs no write, so our own mutation records cannot drive a loop. Returning the input unchanged restores the original and forgets the node.

Skips are central, not per plugin: `SCRIPT`, `STYLE`, `TEXTAREA`, `INPUT`, `SELECT`, `OPTION`, `CODE`, `PRE`, `KBD`, `SAMP`, `NOSCRIPT`, `IFRAME`, `CANVAS`, `SVG`, `TITLE`, plus anything inside `[contenteditable="true"]` or Slick's own panels. **A composer draft must never be rewritten**; the tests assert this directly.

### Network interception

`api.net.request(fn)` and `api.net.socket(fn)` are the reason early injection is worth the complexity: the legacy renderer plugins patch `fetch` and `WebSocket.prototype.send` after Slack has already captured them. Both return whether the patch installed, which is what a plugin should pass to `api.installed`.

`request` hooks receive `{ url, method, body, setBody(next), block() }` over `fetch`, `XMLHttpRequest`, and `navigator.sendBeacon`. Hook order is registry order and a `block()` stops the chain.

- A blocked `fetch` resolves with an empty **204** response. 204 is a null-body status, so the constructor must be called with `null`, not `''` — passing a body throws, and the throw would silently fall through to the real request.
- A blocked `XMLHttpRequest` is not sent; `error` and `loadend` are dispatched asynchronously, which is what main-process URL blocking already looks like to the caller. `readyState` cannot be moved from outside, so handlers keyed on `readystatechange` never fire.
- A blocked `sendBeacon` returns `true` without sending.
- `setBody` only applies to a body passed through `init`/`send`; a `Request` object's own body is not rewritten. `FormData` and `URLSearchParams` are mutated in place instead, because the caller keeps its own reference.

`socket` hooks receive `(data, url)` and return `null` to drop the frame, a replacement value, or nothing. Reading `url` is guarded: an unusual receiver can throw, and the hook is still useful without it.

## Ported plugins

Native descriptors (hand-written against the plugin API) stay the right shape for anything that needs module, store, or geometry hooks. `runtime/from-legacy.js` plus `runtime/embed.js` wrap a legacy renderer IIFE at **build time** into a real `setup` function that is serialized with the bundle. That is not page-world `eval`: Slack CSP continues to block `eval` / `new Function` in the document. Embedded renderers run only while the plugin is enabled, and only when `document` exists, so fetch/WebSocket patches still land at `document_start`.

| Plugin                 | Default | Path                         | Notes                                                                                      |
| ---------------------- | ------- | ---------------------------- | ------------------------------------------------------------------------------------------ |
| `NoTrack`              | on      | native `net.request`         | Same endpoints the desktop main process blocks                                             |
| `SilentTyping`         | off     | native `net.socket`          | Drops `typing` / `user_typing` frames                                                      |
| `ClearURLs`            | off     | native `net.request`         | Provider rules come from the platform; runs before `NotShitMarkdown`                       |
| `NotShitMarkdown`      | off     | embed                        | Rewrites outgoing `chat.postMessage` / `update` / `scheduleMessage` bodies                 |
| `AnonymiseFileNames`   | off     | native `File.prototype.name` | One stable masked name per `File`                                                          |
| `Nicknames`            | on      | native store + `component`   | Desktop keeps the legacy nickname menu (`earlyCoexist`)                                    |
| `SlimMessageBox`       | on      | native component + DOM       | Layout CSS reused from the legacy plugin                                                   |
| `Snappy`               | on      | native DOM + style           | Renderer half only; Chromium switches stay in the main process                             |
| `CustomFonts`          | off     | native style + coexist       | System font family early; uploaded files stay on the desktop renderer                      |
| `Censorship`           | off     | native `text`                | Terms, mask style, and kept letters from the legacy schema                                 |
| `CustomSlackbot`       | off     | native style                 | Settings-driven CSS only                                                                   |
| `Click2Load`           | off     | embed + main                 | Renderer patches iframes early; gateway redirects stay in `main()`                         |
| `LastSeen`             | off     | embed                        | Presence/message observations from the page                                                |
| `UserPronouns`         | off     | embed                        | Pronoun labels next to senders                                                             |
| `WhoReacted`           | off     | embed                        | Reactor avatars                                                                            |
| `CopyReacted`          | off     | embed                        | Copy the reactor list                                                                      |
| `ShowRealUser`         | off     | embed                        | Relay-bot original sender                                                                  |
| `PrivateChannelMapper` | off     | embed                        | Local/Flaron private channel names                                                         |
| `CustomNameRecording`  | off     | embed                        | Custom name-recording upload control                                                       |
| `HcaStatus`            | off     | embed + main                 | Renderer can fetch HCA; main polling remains an optimization                               |
| `AdminBackend`         | off     | embed + main                 | Menu injection early; `slick.admin-backend://` opens stay in `main()`                      |
| `ShutUpSlackbot`       | off     | embed + main                 | Page Notification/Audio patches early; Electron `Notification` patch stays in `main()`     |
| `CustomSounds`         | off     | embed + main                 | Renderer rewrites media URLs; `slick-custom-sounds://` file serving stays in `main()`      |
| `StreamerMode`         | off     | embed + main                 | CSS/DOM early; screen-share detection can still use main                                   |
| `BetterCaptions`       | off     | embed + main                 | Overlay early; capture/transcription protocol stays in `main()`                            |
| `MessageLogger`        | off     | embed                        | Deleted/edited message log                                                                 |
| `bChannel`             | off     | embed                        | On beta, skip the extra document-start preload; the shared early preload owns the renderer |
| `oneko`                | off     | embed                        | Vendor GIF is inlined as a data URL so the page does not read the filesystem               |
| `QuietSpotify`         | —       | desktop `main()` only        | Cross-origin Spotify embed frames are not reachable from the Slack page                    |

`api.fiber` exists so a later native rewrite of WhoReacted/CopyReacted/UserPronouns/ShowRealUser does not copy another `__reactFiber$` walk. New plugins should prefer a native descriptor when the work maps onto `net`, `text`, `component`, `style`, or `dom`; use `from-legacy` when the existing IIFE is already self-contained and the cost of a rewrite is the regression risk.

### Nicknames

Slack's `state.members` was observed as a **prototype-chain dictionary**. `Object.keys(state.members)` can be empty while `state.members[id]` works. Spreading the dictionary loses inherited members. Rebuilding a projected dictionary on every unrelated state update also defeats selector memoization.

Use cached proxies for member reads. Preserve unmodified member identity and the original raw state. Respect Proxy invariants for frozen own properties. Change display/real-name fields and derived normalized fields, but retain `member.name`, which is a handle rather than a display name.

State projection alone does not reliably refresh cached sender selectors. `BaseMessageSender` accepts `userId` and `overrideNameText`; transforming the latter provides a directly reactive message-author label. Avoid overriding its connected parent.

Redux `createStore` may be behind a minified export key. Match the function name rather than hardcoding a module ID or export key. Read data properties and only the observed identifier-only arrow getter form, such as `()=>P`. **Getter length does not establish safety:** `()=>load()` is short but runs code. Unsupported getter forms should be skipped until independently investigated.

Browser profile-menu nickname editing is not implemented; the extension options page accepts member IDs and local names. Desktop retains the legacy nickname menu and routes edits through the early settings adapter when early Nicknames is active. Mentions, search, and every sidebar/member surface are not covered by the message-sender test; validate each before claiming parity.

### SlimMessageBox

The component props map is:

| Setting          | Prop set on the inner component                                    |
| ---------------- | ------------------------------------------------------------------ |
| `hideFormatting` | `enableComposerButton: false`                                      |
| `hideEmoji`      | `enableEmojiButton: false`                                         |
| `hideMention`    | `enableMentionButton: false`                                       |
| `hideVideo`      | `enableStoryButton: false`                                         |
| `hideAudio`      | `enableAudioButton: false`                                         |
| `hideSlash`      | `enableSlashCommandsButton: false`, `enableShortcutsButton: false` |
| `hideBroadcast`  | `dontShowBroadcastControls: true` on `ThreadFooter`                |

Other targets are `TextyButtons`, `WysiwygContainer`, and `MessageInput`. Layout CSS comes from `plugins/SlimMessageBox/index.js`. These names and props are observations of Slack internals, not public APIs.

Composer layout must handle restored drafts, programmatic content changes, width changes, attachments, and settings changes — not just typing:

- Discover `.p-message_input__input_container_unstyled` on startup and in newly inserted subtrees.
- Re-measure from the shared hub's `targets`, so removing an attachment is handled as well as adding one.
- A `ResizeObserver` watches **composer width**, ignoring height changes. An editor-height observer can feed back into itself as stacked layout changes wrapping.
- Coalesce work in one animation frame. Remove the stacked class before measurement so the answer is based on compact geometry rather than the previous layout's width.
- Recalculate on settings changes and viewport resizing. Attachments select stacked layout.
- Disconnect local observers for removed composers; the shared hub handles page hide/show.
- Verify that a settled composer produces no continuing class mutations. Merely delaying a feedback loop with requestAnimationFrame does not fix it.

### ClearURLs

The page never fetches rules. `extension/rules.js` fetches them in the extension world (host permission limited to the ClearURLs rules repository, refreshed at most twice a day, and only while the plugin is enabled) and the bridge attaches them to the config; on desktop the existing main-process fetch supplies them the same way. The `rules` setting is marked `platform: true`, so the options page does not render it.

Rules are untrusted regular-expression source. `coerce` caps the provider count (500), the pattern length (400), and the rules per provider (100), and drops anything that is not a string. A pattern that fails to compile is reported against the plugin, not thrown.

### NoTrack

Blocking at the page level is a superset of the desktop main-process block, so both may run without conflict; the main-process rules stay in place regardless. In a browser this is the only available mechanism. Relative and protocol-relative URLs are resolved before matching.

### Censorship

Terms are sorted longest-first and joined into one pattern with word-boundary lookarounds built from `\p{L}\p{N}_`, so a term that starts or ends with a word character does not match inside a longer word. Compilation is memoized on the settings signature.

### Snappy

Only the renderer half ports: the animation-suppressing CSS and the composer `spellcheck` attribute. `ignoreGpuBlocklist` and `disableCrashReporter` are Chromium switches applied by the desktop main process and stay in the legacy schema. Existing editors are re-scanned directly on a settings change, because the shared observer only announces new nodes.

### CustomFonts

Only `fontFamily` ports. The uploaded-font-file setting needs a privileged file read and a custom protocol handler, so it stays on the desktop legacy path.

## Desktop arbitration

`scripts/byoe/early-settings.js` is generic over `window.__slickEarly.plugins`. It builds the config from the loader's enabled list and `pluginSettings`, migrates page-local nicknames once when no persisted mapping exists, and gates each plugin on its own probe. An explicit empty saved mapping remains authoritative; later sessions cannot restore deleted names.

The adapter also exposes a redacted `report()` for the desktop settings surface. It reports only categorical per-plugin state (`early`, `legacy`, `pending`, or `disabled`), categorical fallback reasons, the late flag, and an error count. Raw error messages, Slack module IDs, settings values, and page data are intentionally excluded. The main process adds a content hash of the generated early bundle/preload and the local runtime environment before rendering or copying the report.

Activation resolves per plugin:

- `diagnostics.late`, or any error whose `capability` is not a plugin id, disqualifies the whole early path.
- An error recorded against a plugin disqualifies **only that plugin**.
- Otherwise the descriptor's `probe` decides, defaulting to `diagnostics.installed[id] === true`.

`activate(waitMs)` waits up to 1.5 seconds for every enabled plugin's probe to pass, then fixes the selection until navigation. `scripts/byoe/inject.js` skips the legacy renderer script and both the static and dynamic CSS for any plugin that activated early, so no plugin is patched twice. Two exceptions exist, both because the early runtime owns only part of a plugin:

- SlimMessageBox's narrow hide-rules CSS is still emitted, with `discordLayout: false`.
- A legacy plugin may set `earlyCoexist: true` on its module. Its renderer then still loads and is responsible for suppressing only its own duplicated behaviour. Nicknames does this: the early runtime owns the name projection, but the renderer owns the profile-menu nickname editor, which has no early equivalent. `applyName` returns immediately while `__slickDesktopEarly.active.Nicknames` is set, and edits are routed back through `__slickDesktopEarly.nickname`.

Adding a descriptor for a legacy plugin that keeps any UI of its own means auditing that renderer for exactly this split. A ported plugin with no coexisting half needs no flag.

`scripts/early/desktop.js` restricts settings requests to a registered session's Slack client main frame and validates nickname writes. Browser extension storage remains separate.

## Build and validation

```bash
npm run early:build
npm run check
npm run test:early:electron
```

`npm run check` includes the Node runtime and desktop tests. `test:early:electron` additionally needs the repo's installed BYOE Electron runtime and a graphical environment. It rebuilds the bundle, uses a temporary profile, serves local strict-CSP fixtures through an Electron protocol handler, and removes the temporary profile on completion. It never logs into Slack or sends messages.

The Node suite covers module interception, independent element creators, settings subscription cleanup, refs, getter discovery, plugin failure isolation, descriptor serialization, per-schema coercion, per-plugin activation, and each ported plugin's own logic. `scripts/early/fake-dom.js` supplies a deliberately small DOM — simple selectors, no combinators — for the text, element, and style hubs; anything needing real layout belongs in the Electron fixture instead.

The native fixture asserts early installation, initial/lazy module execution, CSP enforcement, restored multiline and single-line drafts, narrowing/widening, attachments, disable/re-enable, a second composer, idle stability, and, on a second document, the ported plugins against real DOM and real `fetch`/`WebSocket` prototypes: censored message text with drafts and code spans untouched, `spellcheck` and style elements applied and reverted, dropped typing frames, a 204-blocked telemetry request, an end-to-end cleaned `chat.postMessage` body echoed back by the protocol handler, and a masked `File.name`. It also checks that per-plugin activation reports the network and DOM plugins active while Nicknames falls back, since that page renders no message senders.

### Browser testing

1. Build, then load `dist/early-extension` through Chrome's Load unpacked flow.
2. Open the extension's **Options** page. Every registry plugin appears with its own enable checkbox and settings; the page is generated from `plugins-meta.js`, so it needs no edit when a plugin is ported.
3. Open an authenticated Slack client page.
4. Confirm `window.__slickEarly.diagnostics()` reports early installation, expected capabilities, the expected `active` map, and no errors. Check CSP remains present and no script replay occurs.
5. Test a temporary nickname on a visible sender, then restore the original settings.
6. Use a writable DM/channel for composer controls. Announcements can be read-only; zero composer hits there is expected.
7. Test an empty draft, multiline restored draft, resized composer, thread composer, and disable/re-enable. Do not send test messages.
8. For the network plugins, watch the DevTools network panel: `clog`/`beacon` requests should not leave, and a sent message's `chat.postMessage` body should carry cleaned URLs. Verify a typed message still delivers before trusting SilentTyping.
9. Test changes through the extension options page as well as direct `configure()` calls so storage and the bridge are covered.

After each source edit: rebuild, reload the extension, and reload the Slack tab. MAIN-world startup code does not hot-reload. Preserve existing extension settings and drafts when testing.

### Desktop testing

The opt-in main-process registration is `scripts/early/desktop.js`, called by the BYOE loader. It requires the runtime root `.slick-beta` marker and a built bundle, registers both future sessions and the default session, and must run before Slack creates its windows. Default-session access is deferred until Electron is ready. Missing preload support must leave legacy behavior available.

`scripts/release/beta.js` builds and copies the runtime payload and controls the marker. It copies `runtime/`, `extension/`, and the early scripts into the installed runtime root, then builds there — which is why `plugins/` must already have been copied, as all three builders do. Source installers on all three platforms preflight the beta build, configure the app in staging, and only then replace the existing installation. The source macOS builder writes the marker before signing. Downloaded macOS apps explicitly reject `--beta`: modifying a notarized bundle would invalidate signing. Do not retrofit the marker into a signed bundle. Linux and Windows configure beta-capable downloaded payloads in staging before replacement; older payloads without beta support are rejected. Checkout markers are updated after installation. Test both installed and checkout launch paths, then reinstall without beta and verify both markers are removed. Check packaging and updates as well as direct runtime tests.

The native fixture validates the preload mechanism under sandboxing and context isolation. It does **not** validate Slack's real desktop preload, authentication, pop-out windows, huddles, or full installer behavior. Its cross-session settings checks use disposable test data rather than real Slack profiles. Use the existing disposable handoff-app flow and inspect a signed-in desktop workspace plus a child window before recording desktop compatibility. Do not modify or re-sign the official Slack application.

### Performance claims

`hookMs` records time inside module-hook callbacks. It excludes Slack's own boot, React rendering, layout, network, and most discovery work. It is not evidence that the mod is faster than stock Slack or another mod.

The shared observer is a design bet, not a measured win: it replaces several per-plugin document observers with one, but enabling `characterData` for the text pass widens what that single observer reports. Measure before claiming either direction.

Use the established `docs/performance.md` harness with a dedicated fixture profile for controlled before/after comparisons. Keep platform/architecture, enabled plugins, and cache state consistent. Existing performance unit tests are correctness checks, not speed measurements.

## Status and next work

The registry now carries 28 early plugins. Current fixture testing covers the composer layout cases plus the original text, DOM, style, and network capabilities against a real DOM under strict CSP; the Node suite covers descriptor serialization, coercion, activation, fiber walks, the embed host, CustomSlackbot CSS, and NotShitMarkdown body rewriting. These are local fixtures, not live Slack validation, and they do not establish mobile browser support. Live Slack persistence, real message sending, and activation still need platform testing.

Cross-platform installer success and authenticated Slack compatibility are not established by these results. Record actual commands, revision, environment, and results when testing; do not carry earlier prototype observations forward as proof of the current build.

Before replacing the stable loader:

1. Test persistent desktop settings, the real Slack boot/child-window path, and capability-based legacy fallback on each platform.
2. Validate nickname editing and additional name surfaces, distinguishing desktop legacy UI from the browser options page.
3. Confirm on a live workspace that SilentTyping, ClearURLs, and NotShitMarkdown do not break sending, and that NoTrack breaks nothing Slack depends on.
4. Validate broader browser/platform support; Safari, Firefox, and mobile are not established targets.
5. Rewrite high-traffic embed plugins onto native descriptors when a Slack change makes the IIFE fragile; keep `from-legacy` as the compatibility hatch.
6. Run controlled performance comparisons and verify installer, stable rollback, and update behavior with packaged artifacts. The embed host increases the generated bundle (~400 KiB with the current catalog); measure before claiming startup impact.

Keep this guide focused on contracts, failure mechanisms, and reproducible checks. Avoid treating old module IDs, local temporary scripts, or a successful boot as proof of complete feature parity.
