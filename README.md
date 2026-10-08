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
- **Desktop sign in with cookies**: Slick can sign you in to Slack without opening a browser if you provide it your `d` cookie! Great for sandboxed installs.
- **Themes**: pick from a few built-in themes, or write your own CSS with Monaco.
- **Updates**: Slick handles all the updates for itself and Slack automatically, so you don't have to worry about it.
- **Cross-platform**: Slick works on macOS, Windows, and Linux and browsers through extensions or Violentmonkey.
- **Open source**: Slick is free and open source under the GPLv3 license. You can inspect the code, contribute, or fork it to your heart's content.
- **Fully private**: Slick does not collect any of its own and disables Slack's spyware.

## Compare

| Feature                      | **Slick**                                 | [Taut](https://github.com/jeremy46231/taut) | [Rope](https://github.com/anirudhb/rope) |
| ---------------------------- | ----------------------------------------- | ------------------------------------------- | ---------------------------------------- |
| Actively updated             | **Yes**                                   | **Yes**                                     | No                                       |
| Theme support                | **2 Built in themes + Monaco CSS editor** | CSS editor                                  | No                                       |
| Plugins                      | **36**                                    | 33                                          | 8                                        |
| Desktop sign in with cookies | **Yes**                                   | No                                          | N/A                                      |
| Message Logger               | **Deletions + Edit history**              | Out of scope                                | No                                       |
| Auto updates                 | **Client and Slack update together**      | Slack version is pinned                     | Manual updating required                 |
| Supported platforms          | All desktop platforms                     | **Desktop + Browsers**                      | Browser only                             |
| Privacy                      | **Blocks all telemetry**                  | Replaces Slack's telemetry with its own     | Does not block telemetry                 |
| Code sourcing                | **Bundled in the app**                    | Fetched from a remote server                | **Bundled in the userscript**            |

I encourage you to try other Slack mods, but you will find that Slick is the better choice for most!

## Installation

Slick is widly available on platforms all shapes and sizes. Just scroll down to your platform and follow the instructions.

### Web

- **Firefox:** open `slick-firefox-*.xpi` from the [latest release](https://github.com/3kh0/slick/releases/latest) with Firefox and approve the install.
- **Chrome / Chromium:** download and extract [`slick-chromium.zip`](https://github.com/3kh0/slick/releases/latest/download/slick-chromium.zip). Open `chrome://extensions`, enable **Developer mode**, click **Load unpacked** and select the extracted folder.
- **Userscript:** install [Violentmonkey](https://violentmonkey.github.io/) or any other userscript manager, then open [`slick.user.js`](https://github.com/3kh0/slick/releases/latest/download/slick.user.js) and install it.

Reload Slack in your browser after installing for the changes to take effect.

### macOS

With [Homebrew](https://brew.sh/) (macOS 13+, Apple Silicon or Intel):

```bash
brew install --cask 3kh0/tap/slick
```

If you already have Slack installed or do not want to use Homebrew, you can also install Slick via this one-liner:

```bash
curl -fsSL https://raw.githubusercontent.com/3kh0/slick/main/install.sh | bash
```

For Slack elsewhere, add `-s -- --slack-app "/path/to/Slack.app"` after `bash`. You can also download the `.dmg` from the [latest release](https://github.com/3kh0/slick/releases/latest) and drag Slick to Applications. From the files, pick `mac-arm64` for Apple Silicon and `mac-x64` for Intel based Macs.

If you are not using the homebrew tap, you'll also need [Slack from slack.com](https://slack.com/downloads/mac) in `/Applications/Slack.app`. **The App Store version won't work!!**

### Windows

Install [Slack](https://slack.com/downloads/windows) first (the Microsoft Store version works too), then paste this into PowerShell:

```powershell
irm "https://raw.githubusercontent.com/3kh0/slick/main/install.ps1" | iex
```

The installer picks the build that matches your Slack install and sets everything up for you nicely.

### Linux

On x86_64, install [Slack](https://slack.com/downloads/linux) first. The ARM64 AppImage and Flatpak download their own Slack bundle on first launch.

**Fedora** (x86_64), using [COPR](https://copr.fedorainfracloud.org/coprs/echolive/slick/):

```bash
sudo dnf copr enable echolive/slick
sudo dnf install slick
```

**Flatpak** (x86_64 or ARM64):

```bash
flatpak install --user https://3kh0.github.io/slick/dev.slick.Slick.flatpakref
```

Open Slick from your app menu, or run `flatpak run dev.slick.Slick`.

**Nix** (x86_64 only):

```bash
nix run github:3kh0/slick
```

**Other distros:** grab an AppImage, `.deb` or `.rpm` from the [latest release](https://github.com/3kh0/slick/releases/latest). For an AppImage, make it executable in its file properties and open it.

<details>
<summary>Other installers, uninstalling and building from source</summary>

**Linux installer** (x86_64, with Slack installed):

```bash
curl -fsSL https://raw.githubusercontent.com/3kh0/slick/main/install-linux.sh | bash
```

**Uninstall:** use your package manager (`brew uninstall --cask slick`, `sudo dnf remove slick`, or `flatpak uninstall --user dev.slick.Slick`). For manual macOS installs, drag Slick to the Trash. For the Windows and Linux scripts:

```powershell
& ([scriptblock]::Create((irm https://raw.githubusercontent.com/3kh0/slick/main/install.ps1))) -Uninstall
```

```bash
curl -fsSL https://raw.githubusercontent.com/3kh0/slick/main/install-linux.sh | bash -s -- --uninstall
```

The Windows and Linux scripts keep your sign-in and settings unless you add `-Purge` / `--purge`. To return `slack://` links to Slack, use `-RestoreHandler` / `--restore-handler`. For Flatpak, use `xdg-mime default dev.slick.Slick.desktop x-scheme-handler/slack` if browser sign-in opens the wrong app.

**Build from source:** clone this repo and run `./install.sh` (macOS), `./install-linux.sh` (Linux), or `powershell -ExecutionPolicy Bypass -File install.ps1` (Windows). Plugins live in `src/plugins/<Name>/`.

</details>

## Updates

Slick updates itself every few hours, and checks every download against its GitHub build attestation before installing it. To check by hand, use **Slick > Check for Updates…**. On macOS and standalone Windows it also keeps Slack itself up to date. On Linux arm64, Slick pins the downloaded Slack bundle to its release and downloads a new pin when Slick updates. The Microsoft Store, the deb and rpm packages, Flatpak and Nix update through their own package managers instead. Running through the installer again will also get you the latest version if it somehow breaks.

## Themes

Import a `.json` theme from **Slick Preferences → Appearance → Import theme JSON** (or Appearance in the Firefox toolbar popup). Imported themes are saved, selected immediately, and can be picked again from the theme list or removed with **Remove imported theme**. Match Slack’s native Light or Dark mode to the theme.

The `themes/` folder in the source repository contains built-in themes bundled at build time. Adding files there won't load them into an installed app; use the import button instead. Theme JSON uses this format:

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

Prefer to write your own CSS instead? Open the CSS editor in Slick Preferences (or the Custom CSS field in Firefox). It accepts raw CSS, which applies on top of your selected theme. JSON theme files belong in **Import theme JSON**, not the CSS editor. Choose **Custom CSS only** to use your CSS without a theme.

## Credits

- [Slack](https://slack.com/) for the original app and its delightful internals.
- [Electron](https://www.electronjs.org/) for the runtime and APIs.
- [@ImShyMike](https://github.com/ImShyMike) for advice on breaking into Slack.
- [Vencord](https://github.com/vencord) for plugin inspiration.
- [Taut](https://github.com/jeremy46231/taut) (MIT) by [@jeremy46231](https://github.com/jeremy46231), which has a lovely injection and patching model Slick is built on.
- Claude for cleaning up the code and generally being a good assistant.

## Legal

### Licensing

This is under the GNU General Public License v3.0. See the [LICENSE](LICENSE) file for the legal mumbo jumbo. In short: just don't be a dick. If you're not sure what that means, see [choosealicense.com/licenses/gpl-3.0](https://choosealicense.com/licenses/gpl-3.0/). This code is provided to you for free, use at your own risk. I am not responsible for any harms due to the code here. Don't sue me.

### Privacy

Slick uses data only to provide the plugins, themes and settings you choose. Slick does not run an analytics service, sell data, use data for advertising, or send Slack messages to the Slick developers.

The extension reads the Slack client to customize its interface. Depending on enabled plugins, it processes messages, profile information, user/channel identifiers and activity. MessageLogger keeps bounded local message deletion/edit history; LastSeen keeps local activity records. Settings, CSS, imported themes and plugin records stay in the browser profile. CustomFonts and CustomSounds store files you select locally. Disabling a plugin stops its activity but does not automatically erase its saved data. Plugin controls can clear history where provided; uninstalling the extension removes its extension storage. Plugin logs and ordinary preferences are not encrypted by Slick; access depends on your browser and operating system protections. AccountSwitcher stores session cookies and workspace tokens in a separate extension-private IndexedDB vault encrypted with AES-GCM and a non-extractable key. The key stays in the same browser profile; this is not password or operating-system keychain protection. Credentials are not synced, exported or exposed to the Slack-page bridge.

AccountSwitcher requests optional `cookies`, `browsingData` and `https://*.slack.com/*` access only when you enable session access in its account manager. It verifies sessions with Slack’s `auth.test` endpoint and never sends credentials to Slick servers. A switch pauses normal Slack tabs, replaces the profile’s Slack session cookies and clears cached client data, including unsent drafts. Saved accounts can be removed in the manager; disabling the plugin does not delete them. Private windows and Firefox containers are not switched.

Optional external services: ClearURLs downloads JSON tracking-parameter rules from `raw.githubusercontent.com`; HCA Status sends Slack user IDs to `auth.hackclub.com` and reads verification/age-category results; Private Channel Mapper sends channel IDs or exact channel names to `flaron.halceon.dev` when its external-lookup settings are enabled. These services receive ordinary request metadata such as your IP address and follow their own privacy practices. Slack continues to handle your normal Slack traffic under its own policies. CSS you enter can also request resources you reference in it.

For privacy questions, use the project's [issues page](https://github.com/3kh0/slick/issues); do not include private Slack messages, credentials or local browser-profile data in public reports.
