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

Slick runs Slack's own `app.asar` with a custom Electron (with the handy BYOE acronym, bring your own electron) preload that injects themes and plugins. This method allows us to modify Slack's interface and behavior without altering its files, so auto-updates still work and there's no open debug port or resident watcher.

## Installation

Slick runs on MacOS, Windows, and Linux. Linux is still in beta.

Whatever platform you use, you'll need the official Slack app installed first, since Slick runs Slack's own code.

### MacOS

Install the official [Slack app](https://slack.com/downloads/mac) (not the App Store version) at `/Applications/Slack.app`, then use the installer script:

```bash
curl -fsSL https://raw.githubusercontent.com/3kh0/slick/main/install.sh | bash
```

If you prefer doing it by hand, grab the latest prebuilt app from the [releases page](https://github.com/3kh0/slick/releases/latest) and pick the build for your Mac (check > About This Mac > Chip if unsure):

- `Slick-build-N-mac-arm64` — **Apple Silicon** (if there is a M in the name)
- `Slick-build-N-mac-x64` — **Intel** Macs

Each comes as a `.dmg` (open it and drag Slick to Applications) or a `.zip`.

If you'd rather build it yourself (or hack on it), clone the repo and run:

```bash
./install.sh
```

### Windows

> [!NOTE]
> Both the standalone Slack download and the Microsoft Store version are supported. On ARM PCs the x64 Slack runs via emulation magic and Slick works, but expect a big performance hit. Slick is primary for those on x64 Windows.

Install the official [Slack app](https://slack.com/downloads/windows) first, then run this in PowerShell:

```powershell
irm "https://raw.githubusercontent.com/3kh0/slick/main/install.ps1" | iex
```

To uninstall or pass other arguments to the script, try this:

```powershell
& ([scriptblock]::Create((irm https://raw.githubusercontent.com/3kh0/slick/main/install.ps1))) -Uninstall -Purge
```

If you'd rather build it yourself (or hack on it), clone the repo and run:

```powershell
powershell -ExecutionPolicy Bypass -File install.ps1
```

### Linux (beta)

> [!NOTE]
> Linux support is still in beta and x86_64-only. Slack doesn't ship an official arm64 Linux build, so there's nothing for an arm64 machine to run Slick against.

Install Slack from your distro first (deb, rpm, AUR, whatever your package manager offers), then clone the repo and run:

```bash
./install-linux.sh
```

This builds `byoe/slick-linux`, installs a desktop entry, registers `slack://`, and launches Slick. For manual launch or debugging:

```bash
./scripts/launch-linux.sh
./scripts/launch-linux.sh --debug 9223
```

You also have some nice flags to play around with: `--restore-handler` on `install-linux.sh` to give `slack://` back to the official Slack app, and `./scripts/uninstall-linux.sh` to remove Slick entirely.

Prebuilt `x86_64` tarballs are published on the [releases page](https://github.com/3kh0/slick/releases/latest) too. Extract one and run `Slick/electron` directly; desktop integration is only wired up by the source build (`install-linux.sh`) for now.

## Release versioning

Slick releases use integer build tags: `v13`, `v14`, `v15`, and so on. The GitHub Release title should read like `Slick Build 67`.

Internally, release builds use a normal macOS short version (`1.0.<build>`, e.g. `1.0.67` for build 67), while the bundle build number (`CFBundleVersion`) is just the integer `67`.

To ship the next build, tag and push the next integer:

```bash
BUILD=67 # replace with the next build number
git tag "v$BUILD"
git push origin "v$BUILD"
```

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

No theme is applied by default, but you can pick one from the Slick tab in Preferences. `themes/amoled.json` (true black) and `themes/ultraviolet.json` (violet) are working examples. More documentation pending.

Prefer to write your own CSS instead? Slick also has a "Custom CSS" option at the top of the theme list.

## Plugins

Please refer to [`plugins/README.md`](plugins/README.md) for the plugins documentation. I promise it is not boring.

## Credits

- [Slack](https://slack.com/) for the original app and its delightful internals.
- [Electron](https://www.electronjs.org/) for the runtime and APIs.
- [@ImShyMike](https://github.com/ImShyMike) for advice on breaking into Slack.
- [Vencord](https://github.com/vencord) for plugin inspiration.
- Claude for cleaning up the code and generally being a good assistant.

## Legal

This is under the GNU General Public License v3.0. See the [LICENSE](LICENSE) file for the legal mumbo jumbo. In short: just don't be a dick. If you're not sure what that means, see [choosealicense.com/licenses/gpl-3.0](https://choosealicense.com/licenses/gpl-3.0/). This code is provided to you for free, use at your own risk. I am not responsible for any harms due to the code here. Don't sue me.
