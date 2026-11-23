# Changelog

What changed for people using Slick, newest first. Slick shows this list in the UI.

In a PR that changes something users will notice, add a line under **Unreleased**. Don't add anything chores, CI and dependency bumps, shit that people don't care about. Use `### New` and `### Fixed`, put an entry under `### Highlights` only when it is worth letting everyone know about, since Slick opens a What's new? popup for those. Leave the `## Build N` headings alone since a bot moves entries under them after each release.

## Unreleased

### Fixed

- AMOLED keeps the conversation sidebar true black.

## Build 161

### Highlights

- Slick is now powered by a new loader that is faster and more reliable, and delivers better performance in the browser.

### New

- Snappy's Faster navigation setting now works in browsers.
- CustomAppIcon lets you swap Slick's dock and taskbar icon for a built-in design, Slack's own icon, or your own image.

### Fixed

- BetterBlock no longer hides videos and files in messages forwarded from conversations you can't see.
- MessageLogger only saves image previews hosted by Slack, so a message can no longer reveal your connection to external hosts.

## Build 160

### Fixed

- BetterMessageMenu shows the Delete icon instead of the word "trash".

## Build 159

### New

- NeutralPronouns can rewrite he/she pronouns and nearby verbs in messages you send.
- SlickMCP adds tool controls, agent setup prompts, and linked message attribution.

### Fixed

- Slick’s settings credits include recent contributors.

## Build 158

### Fixed

- Slick shows the latest release notes after updating.

## Build 157

### Highlights

- SlickMCP connects local AI agents to Slack with search, messaging, and desktop controls.

### New

- New docs for AI Agents working on Slick
- BetterMessageMenu lets you reorder, rename, hide, and group message actions, with large buttons near the cursor and optional Vim navigation.

### Fixed

- Slick finds Slack installed as a Flatpak, including in a custom data directory.
- WhoReacted uses each reaction's workspace to show profile pictures when switching workspaces.
- BetterHuddles lets you search for people and invite them to your huddle.
- Nix packages use Slack's matching Electron version to avoid the version mismatch dialog.
- Chat Tabs: Option+Shift+Left/Right no longer switches tabs while you're typing in a message, so it selects by word again. The shortcut and this behaviour can be changed in settings.
- ChatTabs keeps arrow shortcuts in the composer when your draft contains only emoji.

## Build 156

### Highlights

- HideResolved: hide help-channel threads once they are marked resolved.

### New

- MessageLogger can show edit history again.
- ChatTabs now has a "Only keep chats I add" option.
- HaikuWarning only warns when Orpheus is in the channel.
- Slick finds Slack installed from the MSIX package or a direct download on Windows.

### Fixed

- LocalTime no longer shows a time that matches your own.
- The browser extension no longer bundles Slack's remote Chime loaders.

## Build 154

### New

- MessageLogger shows edits as a `git diff` style comparison.
- LetMeSee uses the drawing icons for its drawings button.

### Fixed

- MessageLogger handles thread purges.
- BetterBlock shows the real name of blocked people.
- BetterGIFs works again.
- NoUpsell hides more promo panels.
- Huddle overlays on desktop.
- slack:// links in the Flatpak.
- The Windows installer no longer exits early.
- ChatTabs is more reliable.
- Streamer mode hides recent channels.
- Typing indicators no longer show for threads.

## Build 153

### New

- Self Care plugin.

## Build 152

### Fixed

- BetterHuddles shows more controls.

## Build 151

### New

- BetterHuddles can pop huddles out in the main window.

## Build 150

### Highlights

- New plugins: NoUpsell, BetterHuddles and LocalTime.

### Fixed

- Tab transparency.
- ChatTabs can block the activity tab and has more ways to close tabs.

## Build 148

### Fixed

- ChatTabs works with streamer mode.
- OnlineCount shows real numbers.
