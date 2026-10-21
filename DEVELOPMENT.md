# Developing slick

Thank you for your interest in contributing! This document is a guide to building and testing Slick from source. It assumes you have a working knowledge of Git, Node.js, TypeScript, and the command line.

## Get the damn thing building

Grab yourself a copy of Git, Node.js 24 and Bun. Bun installs dependencies and runs the scripts, but the scripts themselves use Node.

Start with `bun install` in that checkout. Keep `bun.lock`, please don't generate a second lockfile with another package manager!

Pick your target:

| I want to…                       | Run                        | Then                                                                                                     |
| -------------------------------- | -------------------------- | -------------------------------------------------------------------------------------------------------- |
| Hack on the desktop app          | `bun run desktop:dev`      | Sign in to the dev app; [desktop details](#desktop) below                                                |
| Build a userscript               | `bun run userscript:build` | Install `dist/userscript/slick-offline.user.js`; [userscript details](#userscript) below                 |
| Build browser extensions         | `bun run extension:build`  | Load `dist/extension/chromium` or `dist/extension/firefox`; [browser details](#browser-extensions) below |
| Just check that desktop compiles | `bun run build`            | Output is in `dist/desktop`; this does not launch anything                                               |

Writing a plugin? Read the [plugin guide](src/plugins/README.md).

## Desktop

On macOS, Windows and Linux x64, install the official Slack desktop app first. Slick runs Slack's own code inside its bundled Electron. Slack is not needed to compile Slick or run the normal unit tests.

```sh
bun run desktop:dev
```

This builds a debug bundle, launches the project's Electron, and keeps a separate profile at `work/dev-profile`. Your first launch needs a Slack sign-in; later launches reuse that dev profile.

Slick has [HMR](https://webpack.js.org/concepts/hot-module-replacement/), so you can leave it running while you edit and have your changes applied instantly. It watches `src/` and `themes/` and picks the cheapest way to apply each save:

| If you save...                                                                           | Slick will...                                                              |
| ---------------------------------------------------------------------------------------- | -------------------------------------------------------------------------- |
| A file in `src/plugins/<Name>/` that only that plugin's renderer uses                    | Hot reload: the plugin is stopped and its new code started, no page reload |
| Any other page code (`src/app`, `src/shared`, themes, a file another plugin imports)     | `slick.js` is rebuilt and Slack reloads                                    |
| Main or preload code (`src/desktop`, a plugin's `main.ts` or `meta.ts`), or a new plugin | Everything is rebuilt and Electron restarts                                |

A failed build prints the esbuild error and leaves the app alone; fix it and save again. Hot reload only undoes what the old plugin registered through `this.api` (plus its own `stop()`), so anything a plugin's module does at the top level runs again in the new copy. HMR is not bulletproof and may have some edgecases, if you see a plugin not working as intended, give the app a reboot and it should be jazzy again!

Open DevTools with **Slick → Toggle Developer Tools** or `Cmd+Option+I` / `Ctrl+Alt+I`. Renderer messages are prefixed with `[slick]`; main-process logs appear in the launching terminal. `--debug` keeps inline source maps and skips minification.

If you suspect a plugin broke startup, run in safe mode:

```sh
bun run desktop:dev -- --safe-mode
```

### Slack lives somewhere weird

Set `SLICK_SLACK_RESOURCES` to the **directory containing `app.asar`**, not to `app.asar` itself. For example, on macOS:

```sh
SLICK_SLACK_RESOURCES="/Applications/Slack.app/Contents/Resources" bun run desktop:dev
```

On Windows, the PowerShell equivalent is:

```powershell
$env:SLICK_SLACK_RESOURCES = 'C:\path\to\Slack\resources'
bun run desktop:dev
```

The default search covers `/Applications/Slack.app`, Windows standalone/Store installs, and common Linux locations such as `/usr/lib/slack/resources` and `/opt/Slack/resources`. Linux ARM64 downloads a Slack bundle when needed; its native replacements are prepared by the [packaging path](#packaging-optional), so use that path for ARM64 desktop work.

To use another disposable dev profile, set `SLICK_HANDOFF_PROFILE` to an absolute directory before launching. Leave it unset for the normal `work/dev-profile` default.

## Userscript

Yes, this has its own build command lol

```sh
bun run userscript:build
```

For readable code and source maps:

```sh
bun run build -- userscript --debug
```

The output is in `dist/userscript/`:

| File                     | What it is                                                                             |
| ------------------------ | -------------------------------------------------------------------------------------- |
| `slick-offline.user.js`  | Standalone Slick with the CSS editor bundled. **Use this for local dev!**              |
| `slick.user.js`          | Smaller build; its metadata loads the hashed Monaco editor resource from a release URL |
| `slick-monaco-<hash>.js` | Editor resource used by the smaller build                                              |
| `*.meta.js`              | Update metadata, not the script you install                                            |

Install [Violentmonkey](https://violentmonkey.github.io/) in your browser. In its script editor, create a script and replace the entire contents with `dist/userscript/slick-offline.user.js`, then save. Open or reload `https://app.slack.com/client`. Keep only one Slick userscript enabled, and disable the Slick browser extension in that profile while testing the userscript.

After edits: rebuild, replace the installed script's contents again, save, and reload Slack. The browser does not magically read your repo. Disable automatic updates for your local script so a published release doesn't overwrite your work.

The normal `slick.user.js` points its editor resource at a release derived from the build number. A locally changed resource might not exist there. The offline variant avoids that footgun. If you're deliberately testing resource loading, set `SLICK_USERSCRIPT_RESOURCE_BASE` when building to the base URL of the directory serving your generated `slick-monaco-<hash>.js`.

## browser extensions

Build both browsers:

```sh
bun run extension:build
```

Or build just the one you're using, with source maps:

```sh
bun run build -- chromium --debug
# or
bun run build -- firefox --debug
```

### Chromium

1. Open `chrome://extensions` and enable **Developer mode**.
2. Click **Load unpacked** and select `dist/extension/chromium`.
3. Open or reload Slack at `https://app.slack.com/client`.
4. After source edits, rebuild, click the extension's **Reload** button, then reload Slack.

Use the unpacked directory, not `slick-chromium.zip`. Disable another installed copy of Slick and any Slick userscript in the same profile.

### Firefox

After building Firefox:

```sh
bun run extension:dev
```

This uses `web-ext` to launch Firefox with the built extension and open Slack. It watches the **built files** in `dist/extension/firefox`, not TypeScript in `src/`. Rebuild in another terminal after edits; let `web-ext` reload the extension, then reload the Slack tab.

To use your existing browser profile instead, open `about:debugging#/runtime/this-firefox`, choose **Load Temporary Add-on…**, and select `dist/extension/firefox/manifest.json`. Rebuild, reload the temporary add-on, then reload Slack. Temporary installation avoids needing a signed XPI for local testing.

Both builds also produce archives at `dist/extension/slick-firefox.xpi` and `dist/extension/slick-chromium.zip`. Building an XPI does not sign it.

## tests: make the red text go away

The full local check needs **ShellCheck** on your `PATH`, plus a POSIX shell and `xargs` for the shell-lint command. Install ShellCheck with your package manager, for example `brew install shellcheck` on macOS or `sudo apt install shellcheck` on Debian/Ubuntu. On Windows, use a WSL checkout with Linux Node/Bun dependencies for the full check; the individual typecheck, lint and unit-test commands below can run in PowerShell.

```sh
bun run check
```

That runs formatting, TypeScript/JavaScript lint, shell lint, typechecking, and all three unit-test suites. For a quick edit loop, run just what you need:

```sh
bun run typecheck
bun run lint
bun run test:app
bun run test:extension
bun run test:userscript
```

`test:app` covers `src/app`, `src/desktop`, `src/plugins` and `src/shared`. `test:extension` also covers TypeScript tests under `scripts`. `bun run test` runs all three suites through Node's test runner. Use `bun run test`, not `bun test`.

One test file, without waiting for the entire planet:

```sh
node --experimental-strip-types --test src/plugins/ClearURLs/clean.test.ts
```

Format files you touched:

```sh
bun run fmt src/plugins/YourPlugin/index.ts src/plugins/YourPlugin/meta.ts
bun run fmt:check
```

`typecheck` regenerates `src/desktop/mainPlugins.generated.ts`. It's ignored build output; don't edit it by hand.

`bun run readme` regenerates the plugin table in `README.md` and the committed plugin list in `src/plugins/names.generated.ts`, which fixes which plugins the web builds include. Run it after adding, renaming or opting a plugin out of a target; `bun run check` fails while either is stale.

Before submitting changes, also build the affected targets. For changes shared by desktop, extensions and userscripts:

```sh
bun run build -- desktop firefox chromium userscript
bun run extension:lint
bun run extension:validate
git diff --check
```

The extension checks need the built output first. `extension:lint` checks Firefox with `web-ext`; `extension:validate` checks both archives and their shared page bundle. The separate `bun run test:accounts:electron` command exercises desktop account navigation in a disposable Electron profile; use it when changing that code. It needs a working Electron binary and a graphical session.

Green unit tests don't prove that Slack's latest React component still has the same props. Actually open Slack, enable your plugin, exercise the thing you changed, disable it again, and check DevTools for errors. For shared plugins, smoke-test the loaders your change affects. “It compiled” is the beginning of the test, anon.

## packaging (optional)

For an unpacked app on your current operating system:

```sh
bun run build -- package --dir
```

For distributable archives/installers:

```sh
bun run build -- package
```

Output goes to `dist/release`. The default architecture is your Node process's architecture; pass `--arch x64` or `--arch arm64` to select one explicitly. Build on the target OS. Packaging downloads Electron/tooling as needed and may need platform tools, Linux ARM64 also builds native replacements! Start with the ordinary dev loop unless packaging is what you're changing.

The repo installers (`./install.sh`, `./install-linux.sh`, or `powershell -ExecutionPolicy Bypass -File install.ps1`) can build and install from a checkout, but they also replace the installed app and register its `slack://` handler. They're for installing your build, not the everyday edit/test loop.

## common bullshit

| Symptom                                               | Fix                                                                                                                                                                                                                                |
| ----------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Node chokes on `.ts` files                            | Check `node --version`; use Node 24 like CI. Installing Bun alone isn't enough.                                                                                                                                                    |
| Missing Electron binary                               | Check that `ELECTRON_SKIP_BINARY_DOWNLOAD` isn't set. Run `node node_modules/electron/install.js` after dependency installation to download the pinned binary. CI skips that download for non-launch checks; desktop dev needs it. |
| Build passes, app still shows old code                | Rebuild the right target, then reload/restart it. An installed Slick app doesn't read `dist/desktop` from your checkout.                                                                                                           |
| Plugin isn't in the browser build                     | Plugins ship by default: run `bun run readme` after adding one, then check the opt-outs in `src/extension/plugins.ts` and `src/userscript/plugins.ts`. Desktop-only APIs don't become browser APIs by wishing harder.              |
| Slack/Electron version mismatch dialog                | Slick's pinned Electron and the installed Slack need compatible majors. Read the dialog and update the out-of-date side; see `package.json` and `src/desktop/slackFinder.ts`.                                                      |
| Full check fails with `shellcheck: command not found` | Install ShellCheck. `bun install` only installs JavaScript dependencies.                                                                                                                                                           |

The source of truth for commands is [package.json](package.json), [scripts/build.ts](scripts/build.ts), and [CI](.github/workflows/ci.yml). If you change those, update this file too. Save future you from looking like an idiot with a terminal.
