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

Slick runs Slack's own `app.asar` inside its own Electron (with the handy BYOE acronym, bring your own electron). Slick's code runs before Slack's bundle and patches Slack from the inside, through its module system, React, and Redux, rather than by poking at the page afterwards. Slack's files are never altered, both apps keep updating, and there's no open debug port or resident watcher.

## Installation

Slick runs on MacOS, Windows, and Linux. Linux is still in beta.

Whatever platform you use, you'll need the official Slack app installed first, since Slick runs Slack's own code.

### MacOS

Install the official [Slack app](https://slack.com/downloads/mac) (not the App Store version) at `/Applications/Slack.app`, then use the installer script:

```bash
curl -fsSL https://raw.githubusercontent.com/3kh0/slick/main/install.sh | bash
```

If Slack is installed somewhere else, pass its app bundle with `--slack-app`:

```bash
./install.sh --slack-app "$HOME/Documents/Apps/Slack.app"
```

When using the remote installer, pass the option to `bash` like this:

```bash
curl -fsSL https://raw.githubusercontent.com/3kh0/slick/main/install.sh | bash -s -- --slack-app "$HOME/Documents/Apps/Slack.app"
```

If you prefer doing it by hand, grab the latest prebuilt app from the [releases page](https://github.com/3kh0/slick/releases/latest) and pick the build for your Mac (check > About This Mac > Chip if unsure):

- `Slick-2.0.N-mac-arm64` — **Apple Silicon** (if there is a M in the name)
- `Slick-2.0.N-mac-x64` — **Intel** Macs

Each comes as a `.dmg` (open it and drag Slick to Applications) or a `.zip`.

If you'd rather build it yourself (or hack on it), clone the repo and run:

```bash
./install.sh
```

To uninstall, run `./scripts/uninstall.sh` from a clone. It also removes your Slick sign-in and settings.

### Windows

> [!NOTE]
> Both the standalone Slack download and the Microsoft Store version are supported. On ARM PCs the x64 Slack runs via emulation magic and Slick works, but expect a big performance hit. Slick is primarily for those on x64 Windows.

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

Install the official Slack desktop app first (deb, rpm, AUR, or your distro’s package). Download Slick’s x86_64 AppImage (portable), deb, or rpm from [Releases](https://github.com/3kh0/slick/releases), or install the tarball with:

```bash
curl -fsSL https://raw.githubusercontent.com/3kh0/slick/main/install-linux.sh | bash
```

Make the AppImage executable (`chmod +x Slick-*.AppImage`) and run it directly. Install the deb/rpm with your package manager; they add `/usr/bin/slick`, a desktop entry and `slack://` handling. AppImages self-update in writable locations; deb/rpm and Flatpak update through their package managers. Packages use electron-builder’s post-install sandbox setup (user namespaces or a setuid `chrome-sandbox`); the AppImage uses `--no-sandbox` because its mounted filesystem cannot provide a setuid helper. The tarball installer also uses `--no-sandbox`.

To uninstall:

```bash
curl -fsSL https://raw.githubusercontent.com/3kh0/slick/main/install-linux.sh | bash -s -- --uninstall
```

If you'd rather build it yourself (or hack on it), clone the repo and run:

```bash
./install-linux.sh
```

This builds from source into the same `~/.local/share/slick/app` location instead of using a prebuilt release. For manual launch or debugging:

```bash
~/.local/share/slick/app/slick --no-sandbox
~/.local/share/slick/app/slick --no-sandbox --remote-debugging-port=9223
```

You also have some nice flags to play around with: `--restore-handler` on `install-linux.sh` to give `slack://` back to the official Slack app, `--from-release` to use a prebuilt tarball instead of building from source, and `--uninstall` to remove Slick. Your sign-in and settings are kept unless you add `--purge`.

#### Flatpak

The Flatpak still uses Slack's installed `app.asar`, so install the official x86_64 Slack package first. Build and install it from the repository root with:

```bash
bun install --frozen-lockfile
SLICK_BUILD="$(git tag --list 'v[0-9]*' --sort=-v:refname | head -1 | sed 's/^v//')"
flatpak-builder --env="SLICK_BUILD=$SLICK_BUILD" --user --install --force-clean --install-deps-from=flathub \
  .flatpak-build packaging/flatpak/dev.slick.Slick.yml
flatpak run dev.slick.Slick
```

The sandbox has read-only access to the common Slack install locations and stores its separate Slick profile under `~/.var/app/dev.slick.Slick/`.

## Release versioning

Slick releases use integer build tags: `v100`, `v101`, and so on. The GitHub Release title reads like `Slick Build 100`, and the app version is `2.0.<build>` (e.g. `2.0.100`). v1 ended at build 85; v2 starts at build 100, and the release workflow refuses anything at or below 85. The updater compares build numbers only, so every v1 install sees v2 as an update.

To ship the next build, tag and push the next integer:

```bash
BUILD=100 # replace with the next build number
git tag "v$BUILD"
git push origin "v$BUILD"
```

## Verifying builds

All builds published from this repo include [GitHub artifact attestations](https://docs.github.com/en/actions/concepts/security/artifact-attestations) (SLSA build provenance). These prove a given zip, dmg, or tarball was built by this repository's release workflow, not swapped in after the fact.

Install scripts check this automatically when they download a prebuilt release **and** the [GitHub CLI](https://cli.github.com/) (`gh`) is on your `PATH`. If `gh` is not installed, the check is skipped and install continues as before. In-app updates always verify builds after download.

You can also verify a download by hand:

```bash
gh attestation verify path/to/Slick-2.0.N-….zip -R 3kh0/slick
# same idea for .dmg or .tar.gz
```

A successful check confirms the file digest matches a signed attestation from this repo.

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

Plugins live in `src/plugins/<Name>/`: `index.ts` for the part that runs in Slack's page, `meta.ts` for the name, description and settings, and an optional `main.ts` for anything that needs Electron's main process. [`docs/plugins.md`](docs/plugins.md) covers the plugin API and the traps, and [`docs/slack-internals.md`](docs/slack-internals.md) records every Slack-private name Slick depends on.

## Updates

Slick checks for new builds on its own every few hours, and every update is verified against its build attestation before it is installed. To check manually, use **Slick > Check for Updates…**, in the menu bar on macOS and in the menu behind the title-bar button on Windows. Choosing **Later** installs the downloaded update the next time Slick quits.

Slick also keeps Slack itself current where nothing else does: on macOS it stages Slack updates and swaps them in at the next launch, and on Windows it updates the standalone Slack through Slack's own updater. The Microsoft Store and Linux package managers update Slack themselves.

## Credits

- [Slack](https://slack.com/) for the original app and its delightful internals.
- [Electron](https://www.electronjs.org/) for the runtime and APIs.
- [@ImShyMike](https://github.com/ImShyMike) for advice on breaking into Slack.
- [Vencord](https://github.com/vencord) for plugin inspiration.
- [Taut](https://github.com/jeremy46231/taut) (MIT) by [@jeremy46231](https://github.com/jeremy46231), whose
  injection and patching model v2 is built on, and whose resize-gating approach Slick ports directly.
- Claude for cleaning up the code and generally being a good assistant.

## Legal

This is under the GNU General Public License v3.0. See the [LICENSE](LICENSE) file for the legal mumbo jumbo. In short: just don't be a dick. If you're not sure what that means, see [choosealicense.com/licenses/gpl-3.0](https://choosealicense.com/licenses/gpl-3.0/). This code is provided to you for free, use at your own risk. I am not responsible for any harms due to the code here. Don't sue me.
