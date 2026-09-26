<h1 align="center">
  <img src="./assets/icon.png" alt="Logo" width="300" />
  <br />Slick
</h1>
<h3 align="center">The coolest Slack client mod for MacOS, Windows, and Linux</h3>
<div align="center">
  <img alt="GitHub Release" src="https://img.shields.io/github/v/release/3kh0/slick?logo=github&label=Latest%20Build">
  <img alt="GitHub Downloads (all assets, all releases)" src="https://img.shields.io/github/downloads/3kh0/slick/total?label=Downloads&logo=github">
  <img alt="GitHub Repo stars" src="https://img.shields.io/github/stars/3kh0/slick?style=flat&logo=github&label=Stars&color=yellow">
</div>

> [!CAUTION]
> This is in early alpha and may not even be allowed by Salesforce. Expect breakage, bugs, and random crashes. The information here may be inaccurate or incomplete, but the code is open source and you can inspect it yourself.

![screenshot](https://github.com/user-attachments/assets/a5cc6152-cd94-4894-9bc0-cd7c605c291c)

Slick runs Slack's own `app.asar` inside its own Electron (with the handy BYOE acronym, bring your own electron). Slick's code runs before Slack's bundle and patches Slack from the inside, through its module system, React, and Redux, rather than by poking at the page afterwards. Slack's files are never altered, both apps keep updating, and there's no open debug port or resident watcher. This means we are able to patch Slack in a performant and safe way, while still keeping Slack's own updates and security intact.

## Features

- **Kick ass plugins**: Slick has the most plugins of any Slack mod, and you can write your own in JavaScript or TypeScript.
- **Themes**: pick from a few built-in themes, or write your own CSS with Monaco.
- **Updates**: Slick handles all the updates for itself and Slack automatically, so you don't have to worry about it.
- **Cross-platform**: Slick works on macOS, Windows, and Linux with browsers coming soon.
- **Open source**: Slick is free and open source under the GPLv3 license. You can inspect the code, contribute, or fork it to your heart's content.
- **Fully private**: Slick does not collect any of its own and disables Slack's spyware.

## Compare

| Feature             | **Slick**                                 | [Taut](https://github.com/jeremy46231/taut) | [Rope](https://github.com/anirudhb/rope) |
| ------------------- | ----------------------------------------- | ------------------------------------------- | ---------------------------------------- |
| Actively updated    | **Yes**                                   | **Yes**                                     | No                                       |
| Theme support       | **2 Built in themes + Monaco CSS editor** | CSS editor                                  | No                                       |
| Plugins             | **34**                                    | 24                                          | 6                                        |
| Message Logger      | **Deletions + Edit history**              | Out of scope                                | No                                       |
| Auto updates        | **Client and Slack update together**      | Slack version is pinned                     | Manual updating required                 |
| Supported platforms | All desktop platforms                     | **Desktop + Browsers**                      | Browser only                             |
| Privacy             | **Blocks all telemetry**                  | Replaces Slack's telemetry with its own     | Does not block telemetry                 |
| Code sourcing       | **Bundled in the app**                    | Fetched from a remote server                | **Bundled in the userscript**            |

I encourage you to try other Slack mods, but you will find that Slick is the better choice for most!

## Installation

Slick runs Slack's own code. Install the official Slack app first on macOS, Windows, and x86_64 Linux; on arm64 Linux Slick downloads a pinned copy on first launch. Then:

**macOS** (the [official Slack](https://slack.com/downloads/mac) at `/Applications/Slack.app`, not the App Store version):

```bash
curl -fsSL https://raw.githubusercontent.com/3kh0/slick/main/install.sh | bash
```

Got Slack running somewhere else? Add `-s -- --slack-app "/path/to/Slack.app"` after `bash`. You can also grab the `.dmg` or `.zip` from the [releases page](https://github.com/3kh0/slick/releases/latest): `mac-arm64` for Apple Silicon, `mac-x64` for Intel.

**Windows** (the standalone and Microsoft Store versions of Slack both work), in PowerShell:

```powershell
irm "https://raw.githubusercontent.com/3kh0/slick/main/install.ps1" | iex
```

Slick is built for x64. ARM PCs run x64 Slack through emulation, so it works there, just a little slower.

**Linux** (x86_64 or arm64): grab the AppImage, `.deb` or `.rpm` from the [releases page](https://github.com/3kh0/slick/releases/latest), run `nix run github:3kh0/slick`, install the Flatpak, or use the installer below. Whatever floats your penguin loving boat.

```bash
curl -fsSL https://raw.githubusercontent.com/3kh0/slick/main/install-linux.sh | bash
```

On arm64, the AppImage downloads a pinned Slack Linux bundle on first launch, then loads arm64 native addons. This approach is based on [Taut](https://github.com/jeremy46231/taut) (MIT); see [its license notice](./packaging/linux/TAUT-LICENSE.txt). Nix and AUR remain x64-only: arm64 needs separate Slack resources, native addons and platform-specific packaging/pins for each. The arm64 Flatpak downloads the pinned Slack bundle on first launch; the x64 Flatpak still requires installed Slack.

The Flatpak uses a signed Slick repo, so it can update normally via `flatpak update`:

```bash
flatpak install --user https://3kh0.github.io/slick/dev.slick.Slick.flatpakref
```

Launch with `flatpak run dev.slick.Slick` if your desktop menu has not refreshed for some reason. If the browser sign in points elsewhere, run `xdg-mime default dev.slick.Slick.desktop x-scheme-handler/slack` so it takes the slack handler.

To remove the Flatpak, run `flatpak uninstall --user dev.slick.Slick` (use `--system` instead if installed system-wide)

### Uninstalling

- **Windows:** `& ([scriptblock]::Create((irm https://raw.githubusercontent.com/3kh0/slick/main/install.ps1))) -Uninstall`
- **Linux:** `curl -fsSL https://raw.githubusercontent.com/3kh0/slick/main/install-linux.sh | bash -s -- --uninstall`
- **macOS:** Drag the Slick app to the Trash or run `./scripts/uninstall.sh` from a clone.

On Windows and Linux your sign-in and settings are kept unless you add `-Purge` / `--purge`. To hand `slack://` links back to the official app without uninstalling, pass `-RestoreHandler` / `--restore-handler` to the installer.

### Build from source

Clone the repo and run `./install.sh` (macOS), `./install-linux.sh` (Linux) or `powershell -ExecutionPolicy Bypass -File install.ps1` (Windows). They build Slick from your checkout instead of downloading a release. Plugins live in `src/plugins/<Name>/`, one folder each.

### Firefox Extension (experimental)

Slick can also run in the Slack web client as a Firefox extension. Download `slick-firefox-*.xpi` from the [latest release](https://github.com/3kh0/slick/releases/latest) and open it in Firefox.

The extension includes themes, custom CSS and page-side plugins only. Plugins that need the desktop app or network access (AccountSwitcher, NoTrack, CustomSounds and the like) are not in the Firefox build. Settings, custom CSS and recovery controls live behind the Slick toolbar button. **Bypass Slick** reloads the current tab without Slick if Slack ever breaks. Slack's Content Security Policy stays on; nothing is removed or loaded remotely.

## Updates

Slick updates itself every few hours, and checks every download against its GitHub build attestation before installing it. To check by hand, use **Slick > Check for Updates…**. On macOS and standalone Windows it also keeps Slack itself up to date. On Linux arm64, Slick pins the downloaded Slack bundle to its release and downloads a new pin when Slick updates. The Microsoft Store, the deb and rpm packages, Flatpak and Nix update through their own package managers instead. Running through the installer again will also get you the latest version if it somehow breaks.

## Themes

Themes are defined in the `themes/` folder as JSON files exporting the following:

```jsonc
{
  "name": "Super cool epic theme",
  "palette": { "highlight1": { "100": "139,92,246" } }, // --dt_color-plt-<ramp>-<shade>, raw "r,g,b"
  "sidebar": { "nav-bg": "#1A1525" }, // --p-team_sidebar__<key>
  "vars": { "--any-css-var": "value" }, // overrides
  "css": "selector { prop: val !important; }", // raw css (string or array)
}
```

Some people like how Slack looks by default, but you can pick one from the Slick tab in Preferences. `themes/amoled.json` (true black) and `themes/catppuccin-mocha.json` ([Catppuccin](https://catppuccin.com) Mocha) are working examples.

Prefer to write your own CSS instead? Slick also has a "Custom CSS" option powered by Monaco at the top of the theme list.

## Credits

- [Slack](https://slack.com/) for the original app and its delightful internals.
- [Electron](https://www.electronjs.org/) for the runtime and APIs.
- [@ImShyMike](https://github.com/ImShyMike) for advice on breaking into Slack.
- [Vencord](https://github.com/vencord) for plugin inspiration.
- [Taut](https://github.com/jeremy46231/taut) (MIT) by [@jeremy46231](https://github.com/jeremy46231), which has a lovely injection and patching model Slick is built on.
- Claude for cleaning up the code and generally being a good assistant.

## Legal

This is under the GNU General Public License v3.0. See the [LICENSE](LICENSE) file for the legal mumbo jumbo. In short: just don't be a dick. If you're not sure what that means, see [choosealicense.com/licenses/gpl-3.0](https://choosealicense.com/licenses/gpl-3.0/). This code is provided to you for free, use at your own risk. I am not responsible for any harms due to the code here. Don't sue me.
