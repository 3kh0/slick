<h1 align="center">
  <img src="./assets/icon.png" alt="Logo" width="300" />
  <br />Slick
</h1>
<h3 align="center">The coolest Slack client mod for MacOS</h3>
<div align="center">
  <img alt="GitHub Release" src="https://img.shields.io/github/v/release/3kh0/slick?logo=github&label=Latest%20Release">
  <img alt="GitHub Downloads (all assets, all releases)" src="https://img.shields.io/github/downloads/3kh0/slick/total?label=Downloads&logo=github">
  <img alt="GitHub Repo stars" src="https://img.shields.io/github/stars/3kh0/slick?style=flat&logo=github&label=Stars&color=yellow">
</div>

> [!CAUTION]
> This is in early alpha and may not be even allowed by Salesforce. Expect breakage, bugs, and random crashes. Consider using a alt account for testing. Information here may be inaccurate or incomplete, but the code is open source and you can inspect it yourself. No help will be provided for running or modifying it.

![screenshot](https://cdn.hackclub.com/019e981c-32d4-7312-9e7c-b6836219afb1/image.jpg)

Slick runs Slack's own `app.asar` with a custom Electron (with the handy BYOE acronym, bring your own electron) preload that injects themes and plugins. This method allows us to modify Slack's interface and behavior without altering its files, so auto-updates still work and there's no open debug port or resident watcher.

This client targets MacOS, with a Windows beta (see below). The same method could also work on Linux with some adjustments. PRs welcome!

## Installation

You will need the official [Slack app](https://slack.com/downloads/mac) (not the App Store version) installed at `/Applications/Slack.app`, since Slick runs Slack's own code.

The fastest way in is to use the installer script. Re-run it any time to update. Slick also checks for new GitHub Releases about every 6 hours and points you at the latest build when one is available.

```bash
curl -fsSL https://raw.githubusercontent.com/3kh0/slick/main/install.sh | bash
```

Prefer doing it by hand? Grab the latest prebuilt app from the [releases page](https://github.com/3kh0/slick/releases/latest) and pick the build for your Mac (check > About This Mac > Chip if unsure):

- `Slick-build-N-arm64` — **Apple Silicon** (if there is a M in the name)
- `Slick-build-N-x64` — **Intel** Macs

Each comes as a `.dmg` (open it and drag Slick to Applications) or a `.zip`.

### But it says "Slick can't be opened!"

If you run into this error, it means the app is not notarized, which is expected. Bypassing this is trivial:

Double click the app to open it. You should see a warning that it can't be opened. Now, go to **System Settings > Privacy & Security**, scroll down to the Slick message, click **Open Anyway**, and launch it again. After that it opens normally.

You can also use this terminal command to bypass the warning without opening the app first:

```bash
xattr -d com.apple.quarantine /Applications/Slick.app
```

## Build from source

If you'd rather build it yourself (or hack on it), clone the repo and run:

```bash
./install.sh
```

This downloads an Electron matching your installed Slack and builds `~/Applications/Slick.app` locally; re-run it any time to stay fresh. You'll need a modern version of Node.js.

If you want to debug or poke around at things, you can find more manual scripts in the scripts/ folder, but the install script should be all you need for normal use.

## Windows (beta)

> [!NOTE]
> Windows support is new and somehow even more unstable and prone to jank than the Mac build. It only supports the **x64** standalone Slack from [slack.com/download](https://slack.com/download) (not the MS store version). On ARM PCs the x64 Slack runs via emulation magic and Slick works, but expect a big performance hit.

Install Slack first, then run this in PowerShell:

```powershell
irm "https://raw.githubusercontent.com/3kh0/slick/main/install.ps1" | iex
```

To uninstall or pass other arguments to the script, try this:

```powershell
& ([scriptblock]::Create((irm https://raw.githubusercontent.com/3kh0/slick/main/install.ps1))) -Uninstall -Purge
```

### Building Windows

Clone the repo and run the following

```powershell
powershell -ExecutionPolicy Bypass -File install.ps1
```

You also have some nice flags to play around with locally: `-Uninstall`, `-Purge`, `-RestoreHandler`, and `-Force` to overwrite any existing install.

## Release versioning

Slick releases use integer build tags: `v13`, `v14`, `v15`, and so on. The GitHub Release title should read like `Slick Build 67`.

Internally, release builds still use a normal macOS short version string (`1.0.13` for build 13), while the real bundle build number is just `67`.

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

## Plugins

Plugins are defined in the `plugins/` folder as subfolders with an `index.js` file that export the following:

```js
module.exports = {
  meta: { name, description }, // required, shown in the UI
  settings: {}, // optional, user-configurable options (see below)
  main(ctx) {}, // optional, main process
  css, // optional, CSS for every window; a string, or a function of the plugin's settings
  renderer, // optional, JS run in every page
};
```

`ctx` provides `blockURLs`, `injectCSS`, `injectJS`, `onWindow`, `log`, `settings` (the plugin's current values), and raw Electron access. `plugins/enabled.json` lists which load by default. More documentation about these pending.

### Plugin settings

A plugin can also declare additional options that can further customize its behavior. These can be found in the UI as a settings cog next to the plugin in the Slick tab of Preferences. See the following example for the format of these:

```js
settings: {
  someKey: {
    type: 'color', // boolean | text | number | select | color
    label: 'Some key',
    description: 'Shown under the label',
    default: '#e01e5a',
    options: [{ value: 'a', label: 'A' }], // select only
  },
},
```

## Credits

- [Slack](https://slack.com/) for the original app and its delightful internals.
- [Electron](https://www.electronjs.org/) for the runtime and APIs.
- [@ImShyMike](https://github.com/ImShyMike) for advice on breaking into Slack.
- [Vencord](https://github.com/vencord) for plugin inspiration.
- Claude for cleaning up the code and generally being a good assistant.

## Legal

This is under the GNU General Public License v3.0. See the [LICENSE](LICENSE) file for the legal mumbo jumbo. In short: just don't be a dick. If you're not sure what that means, see [choosealicense.com/licenses/gpl-3.0](https://choosealicense.com/licenses/gpl-3.0/). This code is provided to you for free, use at your own risk. I am not responsible for any harms due to the code here. Don't sue me.
