# Early-injection beta

This opt-in prototype runs the plugin catalog through the early runtime, except `QuietSpotify` (desktop main-process only: it has to inject into cross-origin Spotify embed frames). Default-on plugins are unchanged:

| Plugin               | On by default | What it does early                                                       |
| -------------------- | ------------- | ------------------------------------------------------------------------ |
| `NoTrack`            | yes           | Blocks Slack's telemetry endpoints from inside the page                  |
| `Nicknames`          | yes           | Local display names on message senders and member state reads            |
| `SlimMessageBox`     | yes           | Compact composer layout and hidden composer buttons                      |
| `Snappy`             | yes           | Suppresses animations; can disable composer spellcheck                   |
| `SilentTyping`       | no            | Drops your typing indicator before Slack opens its websocket             |
| `ClearURLs`          | no            | Strips tracking parameters from links in messages you send               |
| `AnonymiseFileNames` | no            | Replaces uploaded file names with a random stem                          |
| `CustomFonts`        | no            | System font family (uploaded font files stay on the desktop legacy path) |
| `Censorship`         | no            | Masks chosen terms in message text                                       |

Every other catalog plugin (NotShitMarkdown, Click2Load, LastSeen, UserPronouns, WhoReacted, CopyReacted, ShowRealUser, PrivateChannelMapper, CustomNameRecording, CustomSlackbot, HcaStatus, AdminBackend, ShutUpSlackbot, CustomSounds, StreamerMode, BetterCaptions, MessageLogger, bChannel, oneko) is available early when you enable it. Desktop `main()` still provides custom protocols, external opens, and capture. This is separate from the Linux platform's beta status.

Normal installation uses the stable loader. Beta installation creates `.slick-beta` at the installed Slick runtime root; stable reinstallation removes it. Source installation also writes the checkout root `.slick-beta` for checkout-based launches; stable reinstallation removes both markers. This marker is installation state, not a profile setting. Do not create a marker in Slack's application or change Slack's `app.asar`.

**Validation status:** the native Electron fixture passes, covering composer layout (typing, restored drafts, attachments, resizing, two composers) plus the ported plugins against a real DOM and real `fetch`/`WebSocket` under strict CSP — censored text with drafts untouched, dropped typing frames, a blocked telemetry request, a cleaned `chat.postMessage` body, and a masked file name. Nickname edits, removals, resets, and cross-session settings delivery also pass. An isolated macOS source install/rollback and read-only signed-in launch have also been exercised on Slack 4.51.191 / Electron 43.4.0 / macOS 27 arm64: early injection was on time with zero early errors, the expected enabled ports activated, and the status/copy UI rendered. The cloned profile hit a Slack startup error under both beta and stable, so that run is not a clean full-profile certification. No message has been sent through SilentTyping or ClearURLs on a real workspace as part of this validation. Windows, Linux, real uploads/calls, secondary windows, and destructive settings checks remain unverified.

## Requirements and source checkout

- Use a test workspace/account where possible, respect your organization's policy, and save drafts before restarting.
- Install official Slack first. On macOS, use the slack.com build at `/Applications/Slack.app`, not the App Store build. Windows supports standalone and Store Slack; x64 is the primary target and ARM emulation is a limitation. Linux requires x86_64 Slack with an accessible `resources/app.asar`; this guide does not cover Flatpak beta packaging.
- Install Git and Node.js with npm. Use a current Node.js LTS release; desktop beta also requires an Electron version supporting `session.registerPreloadScript` and `contextBridge.executeInMainWorld`. The installer supplies the BYOE runtime, but an older runtime may not support the prototype.
- Source installation needs network access to download Electron and other installation assets, write access to your per-user application location, and enough space for Electron. macOS integration uses Xcode Command Line Tools; Linux needs a graphical desktop and its usual Electron libraries.
- Back up Slick settings before testing. Quit Slick before copying profile files. Do not share the backup: profiles can contain sessions and workspace data.

Until the changed installers **and** beta-capable payloads are published, do not use the README's remote stable one-liners to request beta. Start with a source checkout containing these changes. A clone of `main` alone will not contain unpublished work:

```sh
git clone https://github.com/3kh0/slick.git
cd slick
```

Check out the exact beta branch or commit supplied by the maintainer using `git checkout REF`, replacing `REF` with that revision. If testing an already supplied working checkout, use it instead of cloning. Confirm that its installer accepts the beta switch before proceeding. Keep the checkout for rebuilds and rollback; do not discard local settings or unrelated changes to switch revisions.

## Desktop installation

Run the command for your OS **from the checkout root**, as your normal user. On all three platforms, source beta installation preflights the runtime build and prepares the configured app in staging before replacing the existing installation. A beta build/configuration failure before replacement leaves the existing app in place. This staging is not a substitute for backing up settings. A browser-extension build alone does not install desktop Slick.

Once updated installers and beta-capable release payloads are published, Linux and Windows can also configure downloaded beta payloads in staging before replacement. Older releases without beta support are rejected. **Downloaded macOS apps do not support beta opt-in**, even after publication; use the source path below.

### macOS

```sh
bash ./install.sh --beta
```

For a non-default official Slack location:

```sh
bash ./install.sh --beta --slack-app "$HOME/Documents/Apps/Slack.app"
```

The source builder writes `.slick-beta` into the staged runtime **before signing** the app. A downloaded macOS install explicitly rejects `--beta` because changing the notarized bundle would invalidate signing. Do not manually add or remove the marker inside a signed app; reinstall from source with or without the flag instead.

Add `--no-launch` to install without opening Slick or quitting official Slack. Launch the installed `~/Applications/Slick.app`, not official Slack. First launch may require signing in again because Slick's different code signature cannot decrypt Slack's session.

### Windows (PowerShell)

```powershell
powershell -ExecutionPolicy Bypass -File .\install.ps1 -Beta
```

Use PowerShell's native **`-Beta`** switch as shown. The installer also declares an alias for `--beta`; `-Beta` avoids shell-specific ambiguity. Do not append arguments to `irm ... | iex`. Use the installed Slick shortcut. The default target is `%LOCALAPPDATA%\Slick`; if you use `-Target`, use that same target on rollback.

### Linux (x86_64)

```sh
bash ./install-linux.sh --beta
```

For Slack outside the installer search paths:

```sh
SLICK_SLACK_DIR=/path/to/slack bash ./install-linux.sh --beta
```

The directory must contain `resources/app.asar`. Launch the installed Slick desktop entry. The default install is `~/.local/share/slick/app` (under `$XDG_DATA_HOME` when set). Do not request an older prebuilt release with `--from-release` for unpublished beta work.

The installed marker locations are:

- macOS: `~/Applications/Slick.app/Contents/Resources/slick/.slick-beta`
- Windows: `%LOCALAPPDATA%\Slick\resources\slick\.slick-beta` (or your custom target)
- Linux: `${XDG_DATA_HOME:-$HOME/.local/share}/slick/app/resources/slick/.slick-beta`

## Settings and rollback

Use **Preferences → Slick** for desktop plugin settings and the existing desktop nickname menu for editing names. When a plugin's capability check succeeds, its early hooks replace that plugin's legacy renderer script and CSS; otherwise the loader retains its legacy behavior. Activation is decided **per plugin**, so one plugin falling back does not affect the others. A beta marker does not guarantee any plugin activated early. `QuietSpotify` has no early path and stays on the desktop main process. Browser settings are separate and do not synchronize with desktop settings.

The **Early-injection beta status** section in Preferences → Slick distinguishes installed opt-in from the current window's activation. It lists each enabled port as `early`, `legacy` with a categorical fallback reason, or `pending`; an unusable/missing preload is reported as `unavailable`. The panel also includes a content-derived runtime revision and the Electron/Chrome environment. **Copy beta report** produces a compact summary without settings values, module IDs, URLs, or raw error messages. Review it before sharing; use the repository's early-injection beta issue template for the remaining Slack version, install command, reproduction, and expected/actual behavior.

Save a copy of the `slick` settings directory under the Slick profile before testing:

| Platform | Default settings directory                  |
| -------- | ------------------------------------------- |
| macOS    | `~/Library/Application Support/Slick/slick` |
| Windows  | `%APPDATA%\Slick\slick`                     |
| Linux    | `~/.config/slick/slick`                     |

To return to the stable loader, quit Slick and rerun the installer from the same checkout **without** the beta switch:

```sh
# macOS
bash ./install.sh
# Linux
bash ./install-linux.sh
```

```powershell
# Windows
powershell -ExecutionPolicy Bypass -File .\install.ps1
```

Retain any custom Slack path or installation target options used originally. This reinstalls the stable loader and removes the installed root `.slick-beta` marker, while leaving profile settings in place. It does not undo settings you edited during testing or downgrade Slack. Do not use uninstall/purge as rollback: Linux's uninstall removes the Slick profile, and other uninstall/purge paths can also destroy settings. If startup fails, use official Slack while troubleshooting; do not delete its profile.

Automatic Slick application updates are disabled while the beta marker is present; the manual update check directs you to rerun the installer with the beta switch. Update your checkout to the maintainer's intended revision first, then reinstall with `--beta` (PowerShell: `-Beta`). This is not a separate beta release feed and does not freeze official Slack updates. An older release may lack the early runtime entirely; recheck activation after any update.

## Browser: build and load unpacked

Desktop installation is not required for the browser prototype. Use a current Chromium browser supporting Manifest V3 MAIN-world content scripts; Firefox, Safari, mobile browsers, and enterprise-managed extension restrictions are not covered here.

From the same source checkout:

```sh
npm run early:build
```

1. Open `chrome://extensions` (or `edge://extensions`) and enable **Developer mode**.
2. Select **Load unpacked** and choose the generated `dist/early-extension` directory, not the source `extension` directory.
3. Open the extension's **Options** page. Every plugin has its own enable checkbox and settings; the page is generated from the built plugin list. Settings use local extension storage.
4. Open or fully reload a signed-in `https://app.slack.com/client/...` tab. The extension only matches that client path, not every Slack website.
5. After source changes, rebuild, reload the extension, and fully reload the Slack tab. Existing tabs do not receive replacement startup hooks automatically.

Only the plugins in the table above are available in the browser prototype; it does not load the legacy desktop catalog. The extension requests one host permission, `raw.githubusercontent.com/ClearURLs/Rules/*`, used by a background service worker to fetch ClearURLs provider rules — only while ClearURLs is enabled, and at most twice a day. The Slack page itself is never given network privileges. Disable other mods implementing the same features during testing. To roll back, disable the extension and reload Slack; disabling keeps extension settings, whereas removing the extension can discard them. Turning the prototype off in Options stops its behavior, but a full reload is needed to remove installed interception.

## Manual test checklist

Record OS/architecture, Slack version, Electron or browser version, Slick revision, and enabled plugins. Do not call a platform validated until someone records a real run there.

- [ ] Install beta and fully relaunch. Confirm the installed runtime has `.slick-beta`; check for startup/preload errors and verify official Slack files were not modified.
- [ ] In Slack's page/main-world DevTools context, inspect `window.__slickEarly.diagnostics()`. On a fresh client navigation, investigate a missing runtime, `late: true`, errors, or absent expected capabilities. A marker alone does not prove successful interception.
- [ ] Change a nickname for a visible message sender, verify it changes, then restore it. Test settings persistence after relaunch and confirm each intended name surface separately.
- [ ] Toggle composer controls in a writable DM/channel and a thread. Check empty and multiline drafts, restored drafts, narrow/wide windows, and an attachment draft. Do not send test messages; do not overwrite someone else's existing draft.
- [ ] Disable/re-enable each prototype plugin. Check that original behavior returns and there are no duplicate legacy patches. Verify an unrelated legacy desktop plugin still works.
- [ ] With SilentTyping on, **send a real message in a test channel** and confirm it delivers; ask someone to confirm no typing indicator appeared. With ClearURLs on, send a link with tracking parameters and check the posted link. Use a test workspace.
- [ ] With NoTrack on, confirm Slack still loads, switches channels, uploads a file, and joins a call. Watch the network panel for failed requests other than `clog`/`beacon`.
- [ ] With AnonymiseFileNames on, upload a file and confirm the stored name is masked and the file still opens. With Censorship on, confirm your own draft and code blocks are never rewritten.
- [ ] Test a second workspace/window and desktop pop-outs. Authentication, huddles, screen sharing, and real Slack preloads need separate live checks.
- [ ] Let an untouched composer sit idle; check for continuing layout changes, CPU activity, or repeated console errors.
- [ ] Reinstall without beta, confirm the marker is gone, relaunch, and verify the stable plugin path works with settings retained.
- [ ] For the browser, also test Options persistence, extension reload plus tab reload, and disabling the extension. Verify Slack's CSP remains intact.

## Automated checks and diagnostics

For contributors, install root development tools and run:

```sh
npm install
npm run early:build
npm run check
npm run test:early:electron
```

`npm run check` also requires ShellCheck on PATH. The Electron fixture requires the repo's BYOE Electron installation and a graphical environment. It exercises a local strict-CSP fixture, not Slack authentication or live workspace behavior. See the [implementation guide](implementation.md) for the contracts and test scope.

For a bug report, start with **Preferences → Slick → Copy beta report**, then include the Slack version, exact install command, reproduction steps, expected/actual behavior, and the smallest relevant redacted error. Desktop **Performance diagnostics → Export diagnostics…** saves a separate redacted local performance report; no automatic upload is performed by either feature. Early runtime diagnostics report hook/capability counters and errors, not an end-to-end speed comparison.

Review everything before posting. Error messages, console logs, screenshots, settings, and reports may expose member IDs, names, workspace URLs, file paths, message text, or other private data. Never attach whole profiles, cookies, tokens, authentication headers, or unredacted network captures. Nickname mappings remain local but are visible to Slack page scripts when projected into the page; the page runtime is not a security boundary against Slack itself.

## Known limitations

- Catalog coverage through the early registry, except QuietSpotify. Browser nickname editing uses member IDs in Options, not a profile-menu entry. Desktop retains its nickname menu, but full mention/search/sidebar coverage is not established by the prototype's sender-label tests. CustomFonts ports the system font family early and keeps uploaded files on the desktop renderer; Snappy only ports its renderer half. Embedded plugins still need live Slack checks before they are advertised as certified.
- Slack's private component names, module exports, and chunk loaders can change without notice. Successful boot does not establish that every hook matched.
- Desktop activation waits up to 1.5 seconds for hook evidence, then keeps its early/legacy selection until navigation. Later-loading hooks remain on the legacy path. When migrating old nicknames, the first document's local map wins; later divergent maps are not merged into saved settings.
- A blocked request is not identical to a main-process block: `fetch` resolves with an empty 204 and `XMLHttpRequest` reports an error without changing `readyState`. ClearURLs only rewrites bodies passed as request options, not a `Request` object's own body.
- Settings arrive asynchronously; first-paint nickname application is not guaranteed. Late injection cannot repair references captured before installation.
- Browser storage and desktop profile storage are distinct. Other browser mods can conflict with the hooks.
- Native fixture success does not validate real desktop Slack, sign-in, child windows, huddles, installer packaging, or every supported architecture.
- No measured speed improvement or full feature parity is promised. Use the [performance guide](performance.md) for controlled comparisons.
