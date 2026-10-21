# AGENTS.md

Notes for coding agents (and humans) working on Slick. Read these first:

- [DEVELOPMENT.md](DEVELOPMENT.md): setup, every build target, the check commands.
- [src/plugins/README.md](src/plugins/README.md): the plugin guide, covering the API, lifecycle, settings, `main.ts`/`browser.ts` and web support.
- [package.json](package.json), [scripts/build.ts](scripts/build.ts) and [CI](.github/workflows/ci.yml): the source of truth for commands.

This file covers what those don't: the Slack internals that bite, how to drive the real app, and how to test each target end to end.

## House rules

- Use Node 24 and Bun. Run `bun install`, and keep `bun.lock` as the only lockfile.
- Format with `bun run fmt <files>` (oxfmt). Never run prettier; it reformats the whole repo the wrong way.
- Use `bun run test`, not `bun test`. The full gate is `bun run check`; also build the targets you touched.
- Keep code comments rare: one short line for a genuinely non-obvious constraint. Put rationale in the PR or chat, not in JSDoc or file headers.
- Match the surrounding code's naming and idiom.
- After adding or renaming a plugin, run `bun run typecheck` and commit `src/plugins/names.generated.ts`. Never hand-edit `*.generated.ts`.
- Use conventional commit subjects (`feat(web): …`, `fix(dev): …`). `main` takes squash merges only.
- Test against Slack itself, not just unit tests. Green tests don't prove Slack's components still have the props you patch.

## Map

| Path               | What it is                                                                                                                                  |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/app/`         | Page code (`slick.js`) shared by every target: plugin manager, Slack discovery (`slack/`), plugin APIs (`api/`), settings UI                |
| `src/desktop/`     | Electron main and preload. The preload rebuilds Slack's document and loads `slick://app/slick.js?v=<mtime>`                                 |
| `src/extension/`   | MV3 extension: MAIN-world page script, isolated relay (`content.ts`), background (`background.ts`, `mainHost.ts`, `blobs.ts`), options page |
| `src/userscript/`  | Violentmonkey build: GM-backed bridge, storage and network                                                                                  |
| `src/plugins/<Id>` | `meta.ts`, `index.ts(x)`, optional `main.ts` (Electron) and `browser.ts` (web)                                                              |
| `src/shared/`      | Types and helpers shared by page, main and web hosts (`Plugin.ts`, `main.ts`, `settings.ts`)                                                |
| `scripts/build/`   | esbuild pipelines per target, plus `build:plugin` and the HMR builder                                                                       |
| `work/`            | Gitignored scratch space: dev profile, benches, logs                                                                                        |

Web plugin lists live in `src/extension/plugins.ts` and `src/userscript/plugins.ts`; `src/extension/plugins.test.ts` enforces them.

## Slack internals that bite

Slack ships minified code that can change weekly. Find things by display name, thunk name, source string or prop shape. Never rely on minified export keys or numeric module ids.

- **Bundler:** Slack is on rspack. The chunk globals are `webpackChunkwebapp`, `rspackChunkwebapp` and `rspackChunkGantryV2` (`CHUNK_GLOBALS` in `src/app/slack/webpack.ts`), and Slick hooks all of them.
- **Module sources:** Slick wraps module factories, so `String(require.m[id])` shows the wrapper. Read Slack's source from the `__slickModuleFactories` Map, or with `getModuleSource(id)`.
- **Never full-scan exports from a per-module callback.** Thousands of modules settle in one task, and a full scan each time hangs the renderer for 15–35 s. Probe only the module that just settled.
- **React 19 renders through the JSX runtime (`jsx`/`jsxs`), not `createElement`.** Patch components with `api.patchComponent`; wrapping `createElement` sees almost nothing.
- **Redux slices hide their data on the prototype.** `messages`, `channels`, `members`, `view` and `presence` return 0 from `Object.keys`, but `slice[id]` still works.
  - Probe them with `Object.getPrototypeOf(slice)`.
  - `state.messages` is two levels deep (`messages[channelId][ts]`), so a one-level `patchSlice('messages')` silently does nothing.
  - Transform on read and never mutate Slack's state. Call `redux.refresh()` after live setting changes, and use `redux.usePatchVersion()` in components that render patched data.
- **Thunks:** about 5,000 thunks are named (`thunkNames()`), so `dispatchThunk('name', args)` is stable. Useful ones:
  - `handleDeepLink` with `{ uri: 'slack://…' }` opens deep links on every platform. `slack://` hrefs do nothing on the web.
  - App tabs are `home`, `messages` and `about`.
- **Message payloads are copied, not shared.**
  - Thread replies render `ThreadReplyGeneric`, not `MessageWrapper`.
  - Search results (`MessageListItem`) and the Activity feed (`ActivityItem`) carry their own copies of messages. Content rewrites need patches on each surface.
- **The composer is Quill 2** (`document.querySelector('.ql-editor').parentElement.__quill`). Edit it through the Quill API with source `'user'`. `execCommand` edits to part of a line are silently undone about 250 ms later.
- **Calling Slack's API from the page:**
  - `fetch('/api/<method>', { method: 'POST', body: FormData })` works from `app.slack.com` with the xoxc token from `localStorage.localConfig_v2.teams[id].token`.
  - The route id can be an enterprise `E…`; enterprise tokens are rejected for some methods where the workspace token works.
  - Other slack.com pages (marketplace, admin) are cross-origin from the page; read them in a privileged half (see `InstalledApps/browser.ts`).
- **Preferences tabs:** the Preferences dialog and the sidebar rail both render through `Tabs`; `settings.tsx` tells them apart by tab ids. Names Slick depends on, and how each was found, are listed where they're used. Re-check with `getRenderedComponent('Name')` when a plugin looks inert.

### DevTools / CDP helpers

These globals are always exposed on the Slack page:

- `__slickPluginManager.info()`.
- Components: `getComponent`, `getRenderedComponent`, `waitForComponent`, `getComponentSource`, `getFiberFromNode`, `[...__slickRenderedComponents.keys()]`.
- Modules: `getExport`, `getByProps`, `getModuleSource`, `getValueSource`, `findModuleId`, `allExports`.
- Redux: `getStore`, `getRawState`, `getThunkCreator`, `thunkNames`.

To reach a running plugin instance, look in the manager for `constructor.id === 'Name'`.

## Driving the desktop app over CDP

```sh
bun run desktop:dev -- --remote-debugging-port=9229
```

- **Profile:** the dev app uses `work/dev-profile` and runs alongside an installed Slick. Its settings are in `work/dev-profile/slick/settings.json`.
- **Connecting:** use `chromium.connectOverCDP('http://localhost:9229')` from `playwright-core`, or Node's built-in `WebSocket` against `/json/list`. The page target is `https://app.slack.com/client/…`.
- **The window is unfocused:** `Input.insertText` and key events go nowhere until you send `Emulation.setFocusEmulationEnabled { enabled: true }`. Do the whole interaction in one CDP session.
- **Background windows throttle timers:** a blurred window (`body.p-window--blurred`) leaves virtual lists stuck in `--scrolling` (clicks hit the scrollbar) and API calls lag. Don't mistake that for a plugin bug.
- **Hover cards:** send pointer moves from a trigger into a card in one session without awaiting each reply, or the card closes in the gap.
- **Common routes in Slack's UI:**
  - User menu: `[data-qa=user-button]`, then menuitem **Profile** or **Preferences** (with the **Slick** tab). Clicking a plugin's name toggles it; it's a label.
  - Composer: `[data-qa=message_input] .ql-editor`; type, then press Enter.
  - Edit a message: focus its `.c-virtual_list__item` (`data-item-key` is the ts), press `e`, select all, type, then press Enter.
- **Stopping it:** the profile is passed through an env var, not argv. Kill the dev app by matching the Electron binary under `node_modules/electron/dist`.
- **Stock Slack:** to compare against unmodified Slack in the same window, set `sessionStorage['slick:preload-recovery'] = '1'` and reload; that pass loads stock Slack.

## Testing the web targets end to end

Use `playwright-core` with a real Chromium (Chrome, Helium and others honour `--load-extension`); the Playwright MCP can't load unpacked extensions. Things that apply to every web target:

- **Slack never fires `load`:** navigate with `waitUntil: 'commit'` (or WebDriver `pageLoadStrategy: 'eager'`), then wait for `__slickPluginManager.info()`.
- **Signing in:** copy only `*.slack.com` cookies into a scratch profile instead of signing in. Delete the profile when done, since it holds a live session.

### Chromium extension

- **Launch:** `launchPersistentContext(profile, { executablePath, headless: false, ignoreDefaultArgs: ['--disable-extensions'], args: ['--disable-extensions-except=<dir>', '--load-extension=<dir>'] })`.
  - Copied Chrome cookies are encrypted with the OS keychain, so also drop `--use-mock-keychain` and `--password-store=basic` from the defaults.
  - Get the extension id from the service worker URL.
- **Picking up a rebuild:** restart the browser. `chrome.developerPrivate.reload` disables a `--load-extension` extension (`unsupportedDeveloperExtension`).
- **Calling a privileged half directly:** from `options.html`, send `chrome.runtime.sendMessage({ method: 'plugin.call', args: [id, method, JSON.stringify(args)] })`. The result is a JSON string.
- **Optional permissions:**
  - Under automation, Chrome grants them without a prompt.
  - `permissions.request` needs a real user gesture: a Playwright click works; `element.click()` inside `evaluate` does not.
- **`userScripts` (user plugins):** the API only appears once the per-extension **Allow User Scripts** toggle is on. From a `chrome://extensions` page: `chrome.developerPrivate.updateExtensionConfiguration({ extensionId, userScriptsAccess: true }, cb)`.

### Firefox

- **Driver:** run `geckodriver --allow-system-access`, and install the xpi with `POST /session/<id>/moz/addon/install { path, temporary: true }`.
- **Opening the options page:** content WebDriver can't open `moz-extension://`. Switch to the chrome context and:
  - Get the URL from `WebExtensionPolicy.getByID('slick@3kh0.net').getURL('options.html')`.
  - Open it with `gBrowser.addTab` plus `fixupAndLoadURIString(url, { triggeringPrincipal: Services.scriptSecurityManager.getSystemPrincipal() })`. Retry; the first load sometimes sticks on `about:blank`.
- **Permission prompts:** accept them from the chrome context with `PopupNotifications.getNotification('addon-webext-permissions').mainAction.callback()`.
- **Cookies:** Firefox locks `cookies.sqlite` while running, so copy the db and `-wal`, then delete the non-Slack rows from the copy.
- **Page context:** WebDriver scripts already run in the page; don't use `wrappedJSObject`.
- **Headless clicks:** synthetic `click()` and Cmd+, don't open Preferences; use WebDriver element clicks.

### Userscript (Violentmonkey MV3)

- Load the official `Violentmonkey-mv3-*.zip` unpacked and turn on `userScriptsAccess` as above.
- Install a build from Violentmonkey's options page: `chrome.runtime.sendMessage({ cmd: 'ParseScript', data: { code, cache: {} } })`.
- Don't run the extension and the userscript in the same profile.

## Web platform limits

- **Privileged halves:** extension renderers can't use `api.fetch`. Anything privileged goes through a privileged half (`BACKGROUND_PLUGINS` / `USERSCRIPT_MAIN_PLUGINS`), and the extension host offers only part of `MainCtx` (`src/extension/mainHost.ts`). `main.on` events don't reach web renderers.
- **Size limits:** extension RPC responses are capped at 256 KiB (`MAX_TEXT`), so trim or parse in the half. Blob storage is quota'd per plugin (512 KB by default, 64 MB for `LARGE_STORAGE_PLUGINS`).
- **Cross-origin requests:**
  - Background requests to other hosts need host permissions.
  - Make them optional (`optional_host_permissions`) and request them from a user gesture. A new required permission makes Chrome disable the extension until the user re-approves.
  - Violentmonkey sends cookies only when the half asks for `credentials: 'include'`.
- **User plugins and store policy:**
  - The AMO-listed Firefox build (`SLICK_FIREFOX_CHANNEL=listed`) strips `userScripts`, because AMO allows it only for user script managers.
  - Chrome clears registered user scripts on every extension update; the background re-syncs them on start.
- **Extension updates:** a Chromium tab left open across an update keeps running but loses extension storage until it's reloaded.

## Performance rules

Measure before and after, against stock Slack in the same window; elements restyled and per-function self time are steadier than total ms. Don't regress these:

- **No `ANCESTOR:has(X) .subject` selectors.** Anchor `:has()` on the subject itself (`.p-view_header:has(~ * > .p-threads_view)`). Otherwise every mutation inside the anchor restyles its whole subtree.
- **No universal `transition`/`animation` overrides** (`* { transition-duration: … }`). Any transition longhand on every element makes Chromium diff every property on every restyle.
- **CSSOM rewrites of Slack's sheets:**
  - Only when provably equivalent.
  - Batched, because any change rebuilds the 85k-rule index.
  - Kept out of first paint (wait for the workspace).
  - Reverted on stop.
- **`slick.js` must keep its `?v=` cache-buster.** A fixed URL serves a stale bundle after rebuilds.
- **Benchmark windows must be visible:** windows report `visibilityState === 'visible'` or the numbers are fake. If needed, launch with `--disable-backgrounding-occluded-windows --disable-renderer-backgrounding --disable-background-timer-throttling`.
- **Prefer props to DOM observers:** find UI through `patchComponent` and props, not by watching the DOM. If a plugin must observe, scope the observer narrowly and disconnect it on stop. Every document-wide `subtree: true` observer pays for every mutation Slack's virtual lists make.

## Theming

- **Token names:** themes are JSON in `themes/`. Tokens are `--dt_color-*` and `--sk_*`. Read their live values on `document.body` (the active scope), not `<html>`.
- **Recolor semantic tokens**, including `--dt_color-theme-*` for the sidebar, rail and top bar. Never override the `primary`/`gray` ramps: the sidebar inverts them, and read channels go invisible.
- **Shared tokens:** some tokens serve two purposes (`--sk_foreground_min_solid` is both a surface and placeholder text), so target those surfaces by class.
- **Solid fills:** `base-inv-hgl-*` always get white text.
- **Fallback-only tokens:** some only exist as `var(--x, #hex)` fallbacks (menu hover, send button). Find them by scanning cssRules.
- **Live loop:** with the dev app on CDP, rewrite the `textContent` of `style[data-slick-style]` instead of rebuilding.
- **Slick-owned windows inside Slack's process** need an opaque `<body>` background from the same `prefers-color-scheme` block as their text. Slack repaints window backgrounds, and vibrancy never survives.

## Testing on a real Slack account

You'll usually be signed in to someone's real workspace (Hack Club's, for the maintainers).

- **Read only Slick's state:** use Slick-owned DOM and state, plus ids and counts. Don't log or screenshot message content; crop screenshots to Slick's own UI.
- **No outward actions:** don't post, react, join channels or send anything unless the task explicitly asks for it. Use your own DM for message tests, and clean up afterwards.
- **Leave things as you found them:** restore any plugin toggles you flipped in a profile. Close every browser you launch, and delete scratch profiles that hold copied cookies.
