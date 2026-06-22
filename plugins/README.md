# Slick Plugins

Welcome to the plugins documentation! This is where we build all the fun extra features that make Slick more than just a funky Slack wrapper. You can read this whether you're a user curious how plugins work, a developer looking to build your own, or an AI agent trying to vibeslop something up. Reading this is and taking a gander at some of the existing plugins is the best way to get a sense of how to build your own.

All plugins live in this folder. Each plugin is a subdirectory with an `index.js` file that tells Slick what it is and how to load it. Slick will detect these when it boots, loads the enabled ones, and injects their CSS and renderer JavaScript into Slack windows.

## Creating A Plugin

Create a directory under `plugins/`:

```text
plugins/MySupaCoolPlugin/
  index.js
  renderer.js
```

In the `index.js` file, you will want to export at least `meta` and one of `main`, `css`, or `renderer`. The `renderer` field can be a string of JavaScript, but it is easier for plugins to keep their renderer code in a separate `renderer.js` file and load it with `fs.readFileSync` to keep things tidy.

```js
'use strict';

const fs = require('fs');
const path = require('path');

module.exports = {
  meta: {
    name: 'MySupaCoolPlugin',
    description: 'This plugin does super cool things to make Slack 100x better',
  },

  settings: {
    extraSwag: {
      type: 'boolean',
      label: 'Extra swag mode',
      description: 'Enabling this will make the plugin even swag, but beware of drip overload',
      default: true,
    },
  },

  css: (settings) => (settings.extraSwag ? '.some-selector { display: none !important; }' : ''),
  renderer: fs.readFileSync(path.join(__dirname, 'renderer.js'), 'utf8'),
};
```

Once you are done making your plugin, run the basic checks with `bun check` and then test locally.

## Loading

Slick finds plugins by searching all the folders for `plugins/<dir>/index.js`.

Enabled plugins are chosen in this order:

1. Command args `SLICK_PLUGINS=PluginA,PluginB` if set.
2. The user's persisted Slick settings at `app.getPath('userData')/slick/enabled-plugins.json`.
3. The defaults in `plugins/enabled.json`.
4. All plugins, if all else fails.

`plugins/enabled.json` controls only the default first-run set. Try to keep this lean, we don't want to give people everything and the kitchen sink at first. If your plugin solves a common problem or adds a nice quality-of-life tweak, people will enable it themselves.

## Plugin Export

`index.js` may export these fields:

```js
module.exports = {
  meta: { name, description }, // must have
  settings: {}, // optional user settings
  capabilities: [], // optional advanced features like 'internals'
  css, // optional string or function(settings) => string
  renderer, // optional JS string ran in each page
  main(ctx) {}, // optional main-process setup
};
```

Every plugin must provide the `meta` object and it must export at least one of `main`, `css`, or `renderer`. If these conditions are not met, we will laugh at you.

## UserSettings

User Settings let users configure the fine details of your plugin. They are declared in `index.js` and rendered automatically in Slick Preferences with a neat little settings cog next to your plugin name.

Supported setting types:

- `boolean`
- `text`
- `number`
- `select`
- `color`

Example:

```js
settings: {
  style: {
    type: 'select',
    label: 'Style',
    description: 'What style of swag do you want?',
    default: 'classic',
    options: [
      { value: 'classic', label: 'Classic Swag' },
      { value: 'ultra', label: 'Ultra Swag' },
      { value: 'mega', label: 'Mega Swag' },
    ],
  },
  color: {
    type: 'color',
    label: 'Swag color',
    description: 'Used for highlighting swag in your chats',
    default: '#e01e5a',
  },
},
```

You would want to set `restartRequired: true` on settings that only apply during app startup, such as Chromium switches or other runtime changes. `Snappy.ignoreGpuBlocklist` and `Snappy.disableCrashReporter` are examples of this.

Renderer code reads current settings from:

```js
window.__slickPluginSettings?.MyPlugin;
```

When settings change, Slick updates that object fires of this event on the window:

```js
window.addEventListener('slick:plugin-settings', apply);
```

I would recommend handling this event when a plugin can update live. Use `restartRequired` only when the setting cannot be applied to already-open windows. No one likes restarting.

## Main Process API

`main(ctx)` runs in Electron's main process while Slick is starting. It contains:

- `ctx.name`: plugin directory name.
- `ctx.electron`: raw Electron module.
- `ctx.app`: Electron app.
- `ctx.settings`: this plugin's merged settings.
- `ctx.log(...args)`: logs with a plugin prefix.
- `ctx.blockURLs(patterns)`: blocks matching requests (you should use `ctx.interceptRequests` when possible, but this is a quick and dirty option for simple blocking needs. If you are trying to block telemetry, add it to [NoTrack](/plugins/NoTrack/index.js) instead).
- `ctx.interceptRequests(patterns, handler)`: handles matching requests with Electron `onBeforeRequest` responses.
- `ctx.injectCSS(css)`: injects even more CSS.
- `ctx.injectJS(js)`: injects even more JavaScript.
- `ctx.onWindow(callback)`: runs a callback for each created BrowserWindow.

Use `main(ctx)` for messing with Electron APIs, request blocking, frame hooks, window lifecycle hooks, external links, or data that should be fetched once and pushed into renderer windows.

## Renderer Code

`renderer` is a JavaScript string executed in every Slack page. Most plugins keep the code in `renderer.js` and load it with `fs.readFileSync` as throwing it directly in `index.js` can hella messy.

Use a global guard so the renderer cannot install duplicate observers or monkey patches:

```js
(() => {
  if (window.__slickMyPlugin) return;
  window.__slickMyPlugin = true;
})();
```

A few common patterns you would want to ahere to in your renderer code:

- `MutationObserver` for Slack DOM that is replaced often.
- `window.__slickPluginSettings` plus `slick:plugin-settings` for live settings.
- `localStorage` for user-local renderer state (e.g. nicknames or private channel names).
- React fiber inspection when Slack does not expose an ID in stable DOM attributes.
- Browser API patches for narrow behavior changes, such as `fetch`, XHR, `WebSocket.send`, `HTMLIFrameElement.src`, or `File.prototype.name`.

Please keep renderer patches narrow and reversible when possible. Slack changes its DOM and bundled module shape frequently, so prefer defensive checks and no-op fallbacks over shitting the bed.

## CSS

`css` can be a string or a function of merged settings:

```js
css: `
  .some-selector {
    opacity: .5 !important;
  }
`,
```

```js
css: (settings) => `
  .some-selector {
    color: ${settings.color} !important;
  }
`,
```

Slick will reinject plugin CSS when settings change, so `css(settings)` is the right place for settings-driven styling. Use renderer-inserted `<style>` tags only when the style is tightly coupled to renderer-created UI.

## Internals

When you need deeper access to change Slack behavior, you can patch React component props through Slick's internals bridge. This is a powerful but risky tool, so wield it with care! If plain CSS, DOM, request interception, or a browser API patch is stable enough, use that first. If you still need internals, declare the `internals` capability in your plugin:

```js
capabilities: ['internals'];
```

Then renderer code can wait for:

```js
window.__slickInternals.react.patchProps(componentName, patcher);
window.__slickInternals.react.refresh();
```

You can look at `SlimMessageBox` for an example. It patches `TextyButtons` and `ThreadFooter` props to hide composer controls that CSS alone cannot reliably remove without annoying layout shifts.

## Internal URLs

Several plugins use made up `slick.*` hostnames to handle actions back to the main process. Notable examples include:

- `AdminBackend` navigates to `https://slick.admin-backend/open?...`, then `main(ctx)` validates the request and opens an external URL.
- `Click2Load` uses `https://slick.click2load/?url=...` as a short-lived gateway for blocked embeds.
- `StreamerMode` reports screen-share state through `https://slick.streamer-mode/status?...`.

If a plugin adds a control URL, validate all parameters in `main(ctx)`, restrict protocols and hostnames, and cancel the internal request after handling it. This can avoid using funky IPC or other more risky communication channels, but can be abused if you don't validate and cancel properly.

## Choosing A Pattern

I know this is a lot of options, but it is all about using the simplest tool for the job. You don't want to monkey patch React props if a CSS tweak will do. Here are some general guidelines of which tool to reach for first:

- Use `css` for static visual tweaks.
- Use `css(settings)` for visual tweaks that depend on user preferences.
- Use `renderer` for DOM changes, composer behavior, local UI, browser API patches, or Slack store/fiber reads.
- Use `main(ctx)` for Electron APIs, request blocking, external navigation, cross-frame injection, filesystem reads, or network fetches that should not run inside Slack's page.
- Use `ctx.onWindow` when a plugin needs to push data into windows or listen to BrowserWindow events.
- Use `ctx.interceptRequests` when a plugin needs to redirect or selectively allow requests.
- Use `capabilities: ['internals']` only for deep Slack React prop patching.

## Validation

There is a simple static validation script that lives in `scripts/ci/validate.js` and is part of `bun check` to catch common mistakes and enforce some consistency.

That check just verifies plugin metadata, settings schemas, known capabilities, CSS function return values, and `plugins/enabled.json`. However this does not mean your plugin will work as intended! For that, please test locally with a real Slick renderer and the actual Electron APIs. Test your code! If you don't, we will all laugh at you.
