# Early-injection beta: completion handoff

Updated 2026-09-06. This is the remaining-work plan, not a release certification.

## Goal and meaning of ready

The user wants a lighter, adaptable Slack modification runtime that works on desktop and in browsers, with `--beta` on the installers so other people can opt in. The existing DOM-based desktop loader must remain the default and a usable rollback path. The user authorized implementation and local UI testing, and explicitly allowed corrections to `docs/implementation.md`. They have not requested publishing a release or sending messages to other people.

There are two separate milestones:

1. **Ready for an advertised, limited beta:** a reproducible published revision, tested installation and rollback on every advertised platform, current authenticated Slack validation for the advertised features, actionable diagnostics, and clear limitations.
2. **Ready to replace the stable loader:** sustained compatibility and performance evidence, a supported update/distribution strategy, and either feature parity or an explicit product decision about the remaining legacy plugins.

The checkout is prepared for source-based testing, but milestone 1 is not yet fully established. Do not translate passing fixtures into a claim that live Slack or every installer works. Linux platform beta status is separate from the early-injection opt-in.

Read these alongside this handoff:

- [Implementation guide](docs/implementation.md): architecture, contracts, extension workflow, regression mechanisms.
- [Beta guide](docs/beta.md): tester commands, settings, rollback, limitations, manual checklist.
- [Performance guide](docs/performance.md): measurement methodology.

## Current implementation to preserve

- `runtime/early.js` intercepts Slack's webpack/rspack chunk factories before module execution. It supplies component, state, DOM/text/style, and network capabilities. It does not force-require Slack modules for discovery.
- `runtime/registry.js` carries 28 plugin descriptors (the catalog minus QuietSpotify). Native descriptors cover the original nine plus CustomSlackbot; `runtime/from-legacy.js` embeds the remaining renderer IIFEs at build time. `runtime/bundle.js` serializes their self-contained setup functions and metadata. Some descriptors reuse legacy plugin schemas/CSS, so packaged builds need `plugins/` present.
- `scripts/early/build.js` generates `dist/early-extension`: shared MAIN-world bundle, metadata, desktop preload, and extension files. Generated output is ignored; rebuild it from the revision under test.
- Browser loading uses static MV3 `document_start` content scripts. `extension/bridge.js` transfers settings from isolated extension storage. `extension/rules.js` fetches ClearURLs rules through its narrowly scoped host permission.
- Desktop loading uses `scripts/early/desktop.js`, registered by `scripts/byoe/inject.js`, and `scripts/byoe/early-settings.js`. The installed runtime root `.slick-beta` marker gates registration. Default-session access waits for Electron readiness; future sessions are also registered.
- Desktop settings stay in Preferences → Slick. Activation is per plugin, with a 1.5-second evidence window and a fixed early/legacy selection until navigation. Legacy CSS/scripts must not duplicate an activated early plugin. Nicknames retains the profile-menu editor and CustomFonts retains uploaded-file handling through `earlyCoexist`.
- `scripts/release/beta.js` copies/builds the portable payload and controls the marker. All three handoff builders include the payload; stable packaging removes any stale marker.
- Source installers stage builds before replacing the app. Source beta installation also marks the checkout for checkout-based launches. Stable reinstall removes opt-in markers and keeps profile settings.
- The Slick updater is deliberately disabled for beta installs; manual checks explain how to update through the installer. There is no beta update feed. Official Slack can still update independently.
- macOS source builds place the marker before signing. Downloaded signed macOS apps reject beta opt-in rather than modifying their signed contents. Linux/Windows downloaded payloads have staging support, but need an actual beta-capable published artifact.

### Plugin scope

| Plugin             | Current scope and special concern                                                                         |
| ------------------ | --------------------------------------------------------------------------------------------------------- |
| NoTrack            | Default on; page-level telemetry interception needs live compatibility checks.                            |
| Nicknames          | Default on; sender/member projection and desktop editing bridge. Broader name surfaces are not certified. |
| SlimMessageBox     | Default on; compact composer and button visibility. Real drafts and concurrent composers matter.          |
| Snappy             | Default on; renderer animation/spellcheck behavior. Desktop main-process behavior remains legacy.         |
| SilentTyping       | Default off; websocket typing suppression requires proof that ordinary sending still works.               |
| ClearURLs          | Default off; rules-based outgoing URL cleanup. Request-object body coverage is incomplete.                |
| AnonymiseFileNames | Default off; upload filename transformation needs a real upload/download check.                           |
| CustomFonts        | Default off; system font family only. Uploaded fonts remain on the desktop legacy path.                   |
| Censorship         | Default off; displayed message text only. Must never mutate drafts or code blocks.                        |

The remaining catalog is in the early registry via the embed host (see `docs/implementation.md`). QuietSpotify stays desktop-main-only. Live Slack proof is still required before advertising any newly embedded plugin as certified.

## Evidence already collected

The preceding implementation turn ran these successfully:

- `npm run check`: formatting, lint, ShellCheck, validation, 19 performance tests, and 44 early/runtime/desktop/updater/packaging tests (63 Node tests total at that revision).
- `npm run test:early:electron`: real Electron sandbox/context-isolation fixture with strict CSP, early/lazy modules, restored drafts, resizing, attachments, settings, multiple composers, idle stability, and the ported DOM/text/network behavior.
- A disposable macOS app was built with `--beta`, then rebuilt stable at `/tmp/slick-beta-acceptance/Slick.app`; code-signature verification passed for both, and the stable marker was absent. This was a builder/packaging check, not a full installation or authenticated desktop run.
- Shell installer help paths were exercised. A mocked Linux release failure test checks that missing/failing beta payloads preserve the previous app.

Earlier prototype work observed signed-in Chrome nickname and composer behavior, including typing/clearing without sending. Those observations predate the current nine-plugin build and do not certify it. No current real-workspace message-delivery, upload, huddle, or screen-sharing proof exists in this handoff.

Additional local evidence collected on 2026-09-06 against the uncommitted tree based on `b59f6aab4de290b34c14dbc4d6f3ac9a4c2d4349`:

- `npm run check` passed: formatting, lint, ShellCheck, validation, 19 performance tests, and 45 early/runtime/desktop/updater/packaging tests. The macOS file-watch test now waits one event-loop turn before its immediate write burst so it does not race `fs.watch()` backend startup.
- `npm run test:early:electron` passed with Electron 43.4.0 after rebuilding the nine-plugin runtime.
- In an isolated temporary home, the actual macOS source installer passed stable → beta → beta → stable. Installed and checkout markers matched every transition, the staged app signature verified after each beta install and final rollback, and a sentinel in the settings directory survived. The user's installed app/profile were not replaced.
- The isolated beta app then launched Slack 4.51.191 on macOS 27.0 arm64 with Electron 43.4.0 against a disposable clone of an authenticated profile. The page reported the early runtime present, `late: false`, zero early errors, and `net`, `style`, and `dom` capabilities. The five enabled ports (AnonymiseFileNames, ClearURLs, NoTrack, SilentTyping, and Snappy) settled on the early path; the other four were disabled. Preferences rendered the beta status/revision/environment and the copy action visibly reported `Copied.`
- The cloned profile's initial Activity load logged Slack's minified `TypeError` and invoked Slack's cold-reload watchdog. A fresh stable run from the same source app and a separate clone produced the same error, so it is not currently attributable to early injection; it still prevents treating this as a clean full-profile boot certification. The disposable apps/profiles were moved to Trash after stable rollback.

The checkout has numerous modified and untracked implementation files. At handoff, none of these beta changes have been committed or published by this work. Preserve them; do not reset to main, clean untracked files, or stage only tracked changes and accidentally omit `runtime/`, `extension/`, or the new scripts/docs. Obtain current `git status` before acting. Temporary test files or browser processes may no longer exist.

## Priority 0: close the beta release gates

### 1. Verify the complete installed desktop path

**Work:** exercise actual installers, not just the preload fixture or handoff builder. Start on macOS, then use native Windows and Linux hosts for the platforms being advertised.

- [ ] Install stable → beta → beta again → stable, retaining non-default path/target options. Verify both installed and source-checkout marker states at each step.
- [ ] Start the installed app from its normal shortcut/desktop entry. Confirm the expected runtime and profile are in use, the early preload runs before Slack captures its dependencies, and the official Slack installation is unchanged.
- [ ] Inspect `window.__slickEarly.diagnostics()` in the page/main-world context; record `late`, errors, capability evidence, and active/fallback plugins. A marker or successful app launch alone is insufficient.
- [ ] Verify sign-in and session persistence across relaunch, workspace switching, secondary windows/pop-outs, and ordinary Slack navigation. Check huddles and screen sharing separately.
- [ ] Verify beta settings changes propagate to already-open windows and persist after restart. Confirm stable rollback uses those settings correctly.
- [ ] Verify the `slack://` handler, custom Slack locations, and recovery when startup fails.

**Implementation if failures occur:** fix session registration order, settings delivery, or per-document activation at the actual boundary. Keep missing/unsupported early capabilities on the legacy path. Do not solve startup problems by disabling CSP, sandboxing, or context isolation.

**Done when:** each advertised OS has a recorded successful install/boot/rollback with exact revision, Slack/Electron version, architecture, and observed plugin activation. Unsupported environments must be explicitly excluded rather than implied to work.

### 2. Prove current plugin behavior in authenticated Slack

Use an explicitly authorized test workspace/channel for actions that send messages or upload files. Existing permission to inspect a signed-in account is not permission to send to other people. Prepare read-only/draft checks while waiting for any necessary authorization.

- [ ] Nicknames: add/edit/remove/reset; verify visible senders and member-state consumers, reload/relaunch persistence, second-window delivery, and unchanged underlying user identifiers. Inspect mention/search/sidebar coverage and document exactly what works.
- [ ] SlimMessageBox: empty, single-line, multiline, restored drafts, narrow/wide window, attachments, threads, simultaneous composers, settings toggles, and idle behavior. Restore every temporary draft and setting; never clear a pre-existing user draft.
- [ ] NoTrack: verify only intended telemetry requests are affected and loading/channel switching/uploads/calls still work. Because this is default-on, regressions here block beta advertising.
- [ ] SilentTyping: verify a normal message delivers while typing indicators are suppressed; verify disable/re-enable and reconnect behavior.
- [ ] ClearURLs: verify the posted link is actually cleaned and normal message formatting/delivery survive. Exercise rules-fetch failures, cached rules, disabled state, and any request forms Slack currently uses.
- [ ] AnonymiseFileNames: verify the uploaded stored name changes, bytes are intact, download/open works, and disabling restores normal behavior.
- [ ] Censorship: verify intended displayed text, virtualized/reused message rows, newly loaded history, drafts untouched, and code blocks untouched.
- [ ] Snappy/CustomFonts: verify settings changes and cleanup; preserve desktop-only behavior that the early port does not own.
- [ ] Verify at least one unrelated legacy plugin alongside the early plugins.

**Done when:** every advertised feature has current browser and/or desktop evidence for its claimed host. A feature that cannot be validated should be clearly excluded from the supported beta scope or withheld, not silently treated as verified.

### 3. Validate fallback and delayed capability discovery

**Files:** `runtime/early.js`, `runtime/plugins/*`, `scripts/byoe/early-settings.js`, `scripts/byoe/inject.js`.

- [ ] Exercise missing/renamed component exports, a hook that appears after the 1.5-second activation window, late injection, and a plugin throwing during setup or transformation.
- [ ] Confirm only the affected plugin falls back and no early and legacy behavior simultaneously rewrites the same surface.
- [ ] Verify disabled plugins stay disabled in both paths. Confirm CSS ownership and partially ported plugin coexistence remain correct through toggles and navigation.
- [ ] Add regressions for discovered failures at the closest useful layer; use the real Electron fixture for layout and browser API semantics.

**Done when:** a plausible Slack internal change degrades to working legacy behavior on desktop, reports a useful reason, and does not break unaffected plugins. Browser has no full legacy catalog; missing capability must be reported as unsupported/inactive there.

### 4. Complete installer failure and rollback coverage

**Files:** the three installers, the three `scripts/byoe/build-handoff-*` builders, `scripts/release/beta.js`, `scripts/release/beta.test.js`.

- [ ] Test successful native Windows `-Beta` and the declared `--beta` alias under supported PowerShell versions. Do not assume alias parsing works from static inspection.
- [ ] Test Linux source and downloaded-release installs on native Linux, including custom `SLICK_SLACK_DIR`, XDG locations, `--no-launch`, and stable rollback.
- [ ] Test paths containing spaces, an app already running, unavailable/mismatched Electron, failed build/download/extraction, and failure while moving the staged app into place.
- [ ] Ensure a failed install preserves the previous app and does not leave marker/profile/Slack-path configuration misleadingly changed. Inspect configuration writes before replacement, staging cleanup, process shutdown, and backup recovery.
- [ ] Ensure a stable rebuild/reinstall always removes installed beta opt-in and checkout opt-in where applicable. Verify settings remain present; uninstall/purge is not rollback.
- [ ] Check missing preload APIs produce a visible explanation and usable fallback. Record the actual minimum supported Electron versions from verified APIs/runtime checks.
- [ ] Validate packaged artifacts independently of the source checkout; no accidental absolute developer paths or missing schema/CSS dependencies.

**Done when:** supported install and recovery paths are reproducible and failures have actionable messages without sacrificing an existing working install.

### 5. Make beta status and reports useful to testers

**Local completion update (2026-09-06):** Preferences → Slick now distinguishes installed opt-in from per-window activation, lists categorical early/legacy fallback state, includes a content-derived runtime revision and environment, and copies a redacted beta summary. A structured GitHub issue template collects the remaining Slack version, install command, reproduction, expected/actual behavior, and privacy confirmation. Automated coverage verifies the report states and manifest wiring. A screenshot against authenticated Slack is still pending.

The installer reports its selected channel, but a marker only means opt-in, not successful activation.

- [ ] Inspect the current Preferences/diagnostics UI and add any missing beta status: installed opt-in, actual active plugins, fallback reasons, runtime revision, and manual update/rollback guidance.
- [ ] Provide a copy/exportable diagnostic summary that avoids requiring a tester to know private module IDs. Integrate with the existing redacted performance diagnostics where practical.
- [ ] Check exported early errors/counters for identifiers, message content, paths, or secrets. No automatic upload is needed.
- [ ] Supply an issue-report template: revision, OS/architecture, Slack/Electron/browser versions, install command, active plugins, minimal reproduction, expected/actual behavior, and redacted errors.

**Done when:** a tester can distinguish opt-in from activation and provide enough information for an agent to reproduce a failure without sharing an entire profile or network capture.

### 6. Choose and publish an explicit distribution scope

- [ ] Commit/review the entire beta implementation and identify the exact revision testers should use. Do not give testers a placeholder branch or assume unpublished main contains the work.
- [ ] Audit release workflow inputs/artifacts and ensure the new runtime, extension, adapter, and packaging scripts are included. Retest artifacts built by that workflow.
- [ ] For the initial beta, source-only macOS is an acceptable documented scope. If downloadable macOS `--beta` is a requirement, implement a separately built/signed/notarized beta artifact or a reviewed external configuration design. Never retrofit a marker inside an already-signed app.
- [ ] Keep stable release selection separate from any future beta feed. Until a real feed exists, preserve manual beta updates and test that stable updates resume after rollback.
- [ ] Publish/update tester instructions only when the referenced revision/artifacts exist, with maintainer authorization for publication.

**Done when:** another person can start from the supplied public revision/artifact and follow the guide without access to this developer checkout. No need to build a browser-store distribution or beta auto-update feed merely for a source-only limited beta.

## Priority 1: harden before broad rollout

### Network semantics and settings boundaries

Documented limitations require explicit investigation rather than blanket rewrites:

- Blocked `fetch` resolves with an empty 204; blocked XHR reports an error without changing `readyState`. Verify Slack's callers tolerate these semantics. Implement compatible completion/error behavior if necessary and test event order and terminal states.
- ClearURLs rewrites bodies supplied in options, not bodies owned by a `Request`. Observe current Slack traffic, then implement needed Request handling without consuming streams twice or losing headers/method/signal/credentials.
- Test websocket argument/type handling, unrelated frames, reconnects, and stacked wrappers. A typing filter must never drop normal messages.
- Test rule-provider outage, malformed/oversized data, and extension service-worker restart. Rule fetching must remain data-only and permission-scoped.
- Test first-window nickname migration and conflicting older maps. Current behavior is first map wins, not merging; either retain and explain that choice or implement deterministic conflict handling without silently overwriting saved edits.
- Audit desktop IPC sender/main-frame/session/origin validation and all payload schemas. The page bridge must never become an arbitrary filesystem/network/evaluation API.

### Browser lifecycle and usability

- [ ] Run the current built extension in authenticated Chrome; also test Edge if advertised. Reloading source alone does not replace startup hooks: rebuild, reload extension, then reload Slack.
- [ ] Check Options persistence, per-plugin toggles, invalid input, reset, multiple tabs, storage changes, disabled extension, and uninstall/reinstall expectations.
- [ ] Verify Slack CSP remains intact and no new broad permissions appear.
- [ ] Decide whether member-ID nickname editing is acceptable for this beta. A profile-menu editor would improve usability, but is not required if the limitation is explicit.
- [ ] Keep Firefox/Safari/mobile/store distribution out of the support claim until specifically implemented and tested.

### Performance and durability

- [ ] Use the performance guide to measure stable versus beta with the same environment, enabled features, cache state, and repeat count.
- [ ] Measure startup, interactive readiness, typing latency, idle CPU, mutation/layout activity, memory, and repeated workspace/navigation cycles.
- [ ] Inspect observer/subscription cleanup after composer removal, navigation, settings changes, and page lifecycle transitions.
- [ ] Retain raw local measurements and an anonymized summary. `hookMs` excludes most app work and cannot establish overall speed improvements.
- [ ] Run a multi-day soak through Slack reload/update behavior before making reliability claims. Record the versions tested and regressions found.

## Priority 2: before replacing stable

These are not prerequisites for a clearly scoped nine-plugin source beta:

- Port or deliberately retain the remaining legacy catalog. Some need additional capabilities: React fiber surfaces for WhoReacted/CopyReacted; content rewriting for NotShitMarkdown/ShowRealUser; privileged desktop work for QuietSpotify and uploaded CustomFonts; durable storage for MessageLogger.
- Design and validate beta/stable update channels, signed release distribution, version reporting, and downgrade behavior if automatic beta updates become a product requirement.
- Establish regression CI for relevant native hosts and a repeatable live compatibility qualification process. Offline fixtures remain valuable but cannot predict Slack's private internals indefinitely.
- Set measurable acceptance thresholds for performance and compatibility, then evaluate the actual results before flipping the default.

## How to resume efficiently

1. Read `git status --short`, this file, and the implementation guide. Preserve existing uncommitted work.
2. Run `npm run check` and `npm run test:early:electron` after confirming dependencies. Root checks require ShellCheck; the Electron fixture requires BYOE Electron and a graphical environment. Do not silently skip an unavailable prerequisite.
3. Build a disposable macOS app if working on native startup/packaging:

   ```sh
   node scripts/byoe/build-handoff-app.js \
     --target /tmp/slick-beta-acceptance/Slick.app \
     --profile /tmp/slick-beta-acceptance/profile --beta --force
   codesign --verify --deep --strict /tmp/slick-beta-acceptance/Slick.app
   ```

   `--force` replaces that disposable target. Inspect the wrapper's actual profile selection before launching: it uses `SLICK_HANDOFF_PROFILE` at runtime; passing `--profile` to the builder alone is not proof the launched app will use it. Launch any test process with an explicit disposable profile environment. Do not patch or re-sign official Slack.

4. Inspect the currently available signed-in browser/app instead of assuming a previous debug session is still available. A prior test Chrome used port 9234 and the chrome-devtools-mcp profile with `--password-store=basic --use-mock-keychain`; changing those flags on restart previously lost usable authentication. Avoid unnecessary restarts and preserve extension storage. Do not embed account identifiers or cookies in this handoff or test fixtures.
5. Prioritize one release gate at a time. Record findings and add targeted regressions before broadening plugin scope.
6. Update the evidence below and the beta/implementation guides after actual verification. Keep blocked checks explicitly pending.

## Completion record for the next agent

For each gate, replace “pending” only with evidence or an explicit scope exclusion:

| Gate                                       | Status at handoff      | Required record                                                                                                                                                                    |
| ------------------------------------------ | ---------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Static/Node checks                         | Passed preceding turn  | Revision, command, counts, failures if changed                                                                                                                                     |
| Native Electron fixture                    | Passed preceding turn  | Electron version, command, result                                                                                                                                                  |
| macOS beta/stable builder and signing      | Passed preceding turn  | App artifact, marker state, signature result                                                                                                                                       |
| Full macOS installer + authenticated Slack | Partial local evidence | Isolated install/rollback, signed-in launch, diagnostics, and status UI passed; clean boot, settings mutation, child-window, huddle/screen-share, and normal-profile proof pending |
| Native Windows installer + Slack           | Pending                | PowerShell switches, architecture, install/rollback evidence                                                                                                                       |
| Native Linux installer + Slack             | Pending                | Source/release, paths, install/rollback evidence                                                                                                                                   |
| Current nine-plugin browser validation     | Pending                | Browser/Slack versions, plugin matrix, Options lifecycle                                                                                                                           |
| Real sending/upload/call compatibility     | Pending                | Authorized test surface and minimal results                                                                                                                                        |
| Fallback/degraded-hook live behavior       | Pending                | Missing/late hook evidence, no duplicate behavior                                                                                                                                  |
| Tester status/reporting UX                 | Implemented locally    | Automated state/redaction checks and authenticated visual/copy check pass                                                                                                          |
| Performance/soak evidence                  | Pending                | Comparable runs and measured results                                                                                                                                               |
| Published beta revision/artifacts          | Pending                | Actual revision/URLs and scope                                                                                                                                                     |

Final sign-off should state exactly which milestone is achieved, supported platforms/features, remaining exclusions, and the evidence. Do not call this fully ready solely because all automated tests pass.
