# Writing Slick plugins

The long awaited plugins docs are here! A plugin is a TypeScript class bundled into Slick. It gets helpers for patching Slack's React components, reading and transforming Redux state, handling messages, saving data, and cleaning up after itself. Desktop plugins can also have a privileged `main.ts` half.

Plugins live in `src/plugins/<PluginId>/` and are compiled into the app. If you want to share your creation without PRing it in yet, see [Share it as a file](#share-it-as-a-file)! For building and running your checkout, see [DEVELOPMENT.md](../../DEVELOPMENT.md).

## Your first plugin

Make `src/plugins/HelloSlick/` with these two files. This changes the color of selected text so you can actually see whether it works.

**`meta.ts`**

```ts
import type { SettingsSchema } from '$slick';

export const id = 'HelloSlick';
export const pluginName = 'Hello Slick';
export const description = 'My epic gamer swag plugin. It changes the selection color.';
export const defaultEnabled = false;

export const settings = {
  selectionColor: {
    type: 'color',
    label: 'Selection color',
    default: '#ec4899',
  },
} as const satisfies SettingsSchema;
```

**`index.ts`**

```ts
import { SlickPlugin } from '$slick';
import * as meta from './meta.ts';

export default class HelloSlick extends SlickPlugin<typeof meta.settings> {
  static readonly id = meta.id;
  static readonly pluginName = meta.pluginName;
  static readonly description = meta.description;
  static readonly defaultEnabled = meta.defaultEnabled;
  static readonly settings = meta.settings;
  static readonly requiredAPIs = [] as const;

  start() {
    this.api.setStyle(`
      ::selection {
        background: ${this.config.selectionColor};
        color: #fff;
      }
    `);
    this.log('selection color acquired');
  }
}
```

From the repository root, after the setup in [DEVELOPMENT.md](../../DEVELOPMENT.md):

```bash
bun run typecheck
bun run desktop:dev
```

Sign in, open **Slick → Slick Settings…**, find **Plugins**, enable **Hello Slick**, and select some text. Change the color, then disable the plugin and check that the style disappears. No `stop()` needed here: Slick owns the stylesheet and removes it for you.

Desktop discovery happens automatically. For web platforms, also add `'HelloSlick'` to `EXTENSION_PLUGINS` in [`src/extension/plugins.ts`](../extension/plugins.ts). The userscript list derives from that list, so a renderer-only plugin like this gets included there too. Rebuild and reload your chosen target using the [browser instructions](../../DEVELOPMENT.md).

## The files and the junk

```text
src/plugins/YourPlugin/
  meta.ts         # ID, display name, description, defaults, settings schema
  index.ts        # default-exported SlickPlugin subclass
                  # use index.tsx instead if you write JSX
  main.ts         # optional privileged desktop half
  browser.ts      # optional replacement for main.ts in web builds
  something.ts    # whatever helpers your plugin needs
  something.test.ts
```

The builder scans direct, non-hidden directories and looks for `index.tsx`, then `index.ts`. Even a plugin that does all its work in `main.ts` needs a renderer class; an empty `start() {}` is fine. Keep the folder name, metadata `id`, class's static `id`, and main plugin `id` identical. IDs accept letters, digits, `_`, `.`, and `-`, up to 100 characters.

Keep `meta.ts` free of runtime side effects. Desktop imports it separately to read settings before the renderer starts. Don't rename an existing ID casually: settings and storage use it as their key.

The class fields in the example cover the basics. Optional fields:

| Field              | What it does                                                                        |
| ------------------ | ----------------------------------------------------------------------------------- |
| `authors`          | Display attribution, as Slack mentions such as `'<@U0123456789>'`. Use your own ID. |
| `liveSettings`     | Setting keys that update without restarting this plugin.                            |
| `relaunchSettings` | Setting keys that need a full app relaunch, such as Chromium switches.              |

`defaultEnabled` defaults to `false`. Leave new experiments opt-in. The full class contract lives in [`src/shared/Plugin.ts`](../shared/Plugin.ts).

Users can restrict plugins to selected workspaces from each plugin's gear menu. The host stores these choices in `pluginWorkspaces`, separately from plugin settings, and starts/stops renderer instances as their window's workspace changes. An absent or `null` selection means all workspaces; `[]` means none. Workspace IDs come from the window's `/client/T…` or `/client/E…` route, never shared `lastActiveTeamId` storage. Settings and plugin storage remain shared across the selected workspaces.

After asynchronous work, check `api.isActive()` before opening UI or acting on a retained event. The host aborts `api.signal` and disposes registrations before awaiting `stop()`, including when a workspace restriction changes during startup. Cancel pending work and close dialogs on abort. Process/session-wide plugins are listed with explanations in `src/shared/pluginWorkspaces.ts`; add an entry there if a new plugin owns global effects that cannot be restricted safely.

## Declare the APIs you actually use

```ts
static readonly requiredAPIs = ['redux', 'members'] as const;
```

Slick discovers these integrations before calling `start()`. Accessing one you didn't declare throws `Plugin must declare requiredAPIs: ...`. Omitting the field requests **all** integrations for legacy compatibility. Don't make Slack find half its internals just to inject twelve bytes of CSS; use `[]` when you only need base helpers.

| `requiredAPIs` entry  | What you get                                                                                                 |
| --------------------- | ------------------------------------------------------------------------------------------------------------ |
| `redux`               | `api.redux`: store access, React selectors, state/slice/thunk patches, thunk dispatch.                       |
| `rtm`                 | `api.rtm.on(type, listener)`: incoming events by type, subtype, or `'*'`.                                    |
| `messages`            | `api.messages`: message lookup, modification, and local message injection.                                   |
| `members`             | `api.members`: cached/async member lookup, `useMember`, current user ID, member transforms.                  |
| `channels`            | `api.channels`: cached channel lookup, current channel ID, channel object helpers.                           |
| `blocks`              | `api.blocks`: Quill Delta, Slack blocks, plain text, and Markdown conversion.                                |
| `files`               | `api.files`: Slack file upload helper.                                                                       |
| `elements`            | `api.elements`: discovered Slack UI components.                                                              |
| `menu`                | `api.menu.Menu`: menu component.                                                                             |
| `modal`               | `api.modal`: `openModal`, `confirm`, and `alert`.                                                            |
| `react`               | `api.react`: Slack's React instance.                                                                         |
| `onMessageSendDelta`  | `api.onMessageSendDelta(transform)`: synchronous outgoing-message and edit transform.                        |
| `onMessageSendBlocks` | `api.onMessageSendBlocks(transform)`: synchronous Block Kit transform for sends, edits and scheduled drafts. |
| `addSendCheck`        | `api.addSendCheck(check)`: hold a message back in the composer by returning (or resolving) `false`.          |

Base helpers don't need a `requiredAPIs` entry: `patchComponent`, module/component discovery, `setStyle`, `onDocument`, `deferResizeWork`, `Store`, `storage`, `Cache`, `storedFileUrl`, `settings`, `userAPI`, `fetch`, `main`, `loader`, `id`, and `signal`.

For exact signatures, start with [`SlickAPI` in pluginManager.ts](../app/pluginManager.ts), then the implementations in [`app/slack`](../app/slack) and [`app/api`](../app/api). This is code patching Slack internals, not a Salesforce-blessed SDK. Component names and shapes can change.

## Lifecycle: clean up your shit

`start()` runs when the plugin is enabled. Disabling it calls `stop()`, then disposes its API scope. A normal setting change stops the current instance and starts a new one. API discovery, `start()`, `stop()`, and `onSettingsChange()` each have a five-second timeout.

Keep `start()` fast. Register your hooks immediately; kick off slow work separately, handle rejected promises, and check `this.api.signal.aborted` after awaits before applying results. A timeout doesn't magically cancel your promise. The scope signal aborts **after `stop()` finishes or times out**, so don't make `stop()` wait for that signal.

Slick automatically removes registrations made through these scoped APIs:

- `patchComponent`, `redux.patchState`, `redux.patchSlice`, `redux.patchThunk`.
- `rtm.on`, `messages.injectMessages`, `onMessageSendDelta`, `onMessageSendBlocks`, `addSendCheck`.
- `setStyle`, `onDocument`, `deferResizeWork`, `settings.addTab`, `main.on`.
- Blob URLs created by `storedFileUrl`.

Their registration methods return disposers when you need to remove something early. Stuff you create yourself is still your problem: timers, raw DOM listeners, observers, added elements, store subscriptions, and open UI. Clean those up in `stop()`, use React effect cleanup, or attach a DOM listener with `{ signal: this.api.signal }` where appropriate.

For example, these members go inside your plugin class:

```ts
private timer: ReturnType<typeof setInterval> | undefined;

start() {
  this.timer = setInterval(() => this.log('still here'), 30_000);
}

stop() {
  clearInterval(this.timer);
  this.timer = undefined;
}
```

Keep side effects out of module scope and constructors. Disabled plugins are still bundled and imported.

## Settings without inventing another config system

Read values from `this.config`. The schema builds the settings UI and normalizes values. **`enabled` is reserved**; don't add it to your schema.

Supported types, defined in [`shared/settings.ts`](../shared/settings.ts):

| Type       | Value / extra fields                                                                                              |
| ---------- | ----------------------------------------------------------------------------------------------------------------- |
| `boolean`  | Boolean `default`.                                                                                                |
| `number`   | Numeric `default`, optional `min` / `max`.                                                                        |
| `text`     | String `default`, optional `maxLength`.                                                                           |
| `color`    | Hex color string `default`.                                                                                       |
| `select`   | String `default`, `options: [{ value, label }]`.                                                                  |
| `file`     | String `default`, optional `accept` extension list.                                                               |
| `names`    | Map of Slack user IDs to names. See [Nicknames](Nicknames/meta.ts).                                               |
| `schedule` | Rules with `days`, `start`, `end`, and `status`, plus `statuses` choices. See [OfficeHours](OfficeHours/meta.ts). |

All settings have a `label` and can have a `description`. To save a value from your own UI, use `await this.api.settings.set('selectionColor', '#00aa88')`. Mutating `this.config` directly doesn't persist anything.

By default, saving a setting restarts the plugin. For live updates to the selection-color example, add these members and move the CSS call into `applyStyle()`:

```ts
static readonly liveSettings = ['selectionColor'];

start() {
  this.applyStyle();
}

onSettingsChange(_changed: string[]) {
  this.applyStyle();
}

private applyStyle() {
  this.api.setStyle(`::selection { background: ${this.config.selectionColor}; color: #fff; }`);
}
```

If **every** changed key is in `liveSettings`, Slick updates the existing config object and calls `onSettingsChange(changedKeys)`. Otherwise it restarts the plugin. Read live values from `this.config` when needed; a value you copied into a local variable in `start()` stays stale.

If a Redux slice patch depends on live settings, call `this.api.redux.refresh()` in `onSettingsChange()` to invalidate cached results. See [Nicknames](Nicknames/index.tsx). `relaunchSettings` marks settings needing a full app restart; it doesn't turn a boot-only switch into a live setting.

## Common jobs

### CSS and pop-out windows

`this.api.setStyle(css, 'optional-key')` adds or replaces an owned stylesheet. Reusing the key replaces it; passing `null` removes it. Slick namespaces keys by plugin and mirrors styles into Slack pop-outs.

For DOM work in pop-outs, `this.api.onDocument(callback)` reports additional documents, including already-open ones. It does **not** call you for the current `document`; handle that separately. You still own any listeners or elements you create inside the callback.

### React patches

Use `index.tsx` for JSX. `this.api.patchComponent<Props>('ComponentDisplayName', (Original) => Replacement)` registers a wrapper and returns an unpatch function. Render `<Original {...props} />` inside your replacement and preserve props/children you aren't changing. The matcher can also be `{ displayName, filter, component }`; see [`react.tsx`](../app/slack/react.tsx).

Slack's React is already available as the global `React`. Don't bundle another React runtime. JSX and `React.useState()` can use that global; declare `'react'` if you explicitly access `this.api.react`.

Hooks belong inside components, not `start()`. Assume optional props and missing cached data happen. [HumanCount](HumanCount/index.tsx) is a small component-wrapper example; [UserPronouns](UserPronouns/index.tsx) covers message headers and threads.

### Redux patches

Declare `'redux'`. `patchSlice` transforms entries when read, without modifying Slack's stored state. Return the original entry when nothing changes and return a copy when it does. Don't mutate Slack's objects or fetch things inside a hot selector.

For example, inside `start()`:

```ts
this.api.redux.patchSlice('members', (id, member) => {
  if (id !== 'U0123456789' || !member) return member;
  return {
    ...member,
    profile: { ...member.profile, display_name: 'local nickname' },
  };
});
```

Replace the ID with one you're testing. This is a local view change. [Nicknames](Nicknames/index.tsx) handles the other name fields Slack uses; [SilentTyping](SilentTyping/index.ts) shows a thunk patch. Use `redux.useReduxState(selector)` inside React components for reactive reads.

### Incoming and outgoing messages

For incoming events, declare `'rtm'`, then register `this.api.rtm.on('message', event => { /* ... */ })`. Event fields vary; check them. Subscribe to the specific type/subtype you need instead of processing every event for no reason. [LastSeen](LastSeen/index.tsx) and [MessageLogger](MessageLogger/index.ts) are real examples.

For outgoing messages and edits, declare `'onMessageSendDelta'`. The callback must synchronously return a valid Slack Delta instance, not a promise or a plain `{ ops: [...] }` object. Return the input when unchanged. [NotShitMarkdown](NotShitMarkdown/index.ts) shows how to reuse the incoming Delta's constructor when creating a replacement.

To change the Block Kit Slack actually sends, declare `'onMessageSendBlocks'`. It covers sends, thread replies, resends, edits, scheduled messages, file shares and forwards, including sends and edits from the markdown composer. The callback must synchronously return an array of blocks; return the input when unchanged and new objects when not, never the input edited in place. It has to be idempotent: one message can pass through it more than once, and resends and rescheduled drafts hand it its own output.

To stop a message going out, declare `'addSendCheck'` and return `false` from `this.api.addSendCheck((blocks, { channelId, threadTs }) => ...)`; the message stays in the composer. Checks see what the user wrote, before any transform. A check may return a promise, for example to ask with `modal.confirm`: the message waits in the composer and goes out once every check passes, unless the user has edited it by then. A check that throws or rejects is ignored rather than blocking the send.

### Storage and requests

- `await this.api.storage.get<T>('key', fallback)` reads JSON data. `set`, `delete`, and `clear` return `Promise<boolean>`, check the result if persistence matters. `keys()` lists keys; `entries<T>(prefix)` reads a group.
- `this.api.Cache<T>('name', ttlMs, maxEntries)` creates a persistent TTL cache. `maxEntries` bounds the in-memory cache, **not** all persisted data. Plan retention for logs and files.
- Storage is scoped to the plugin ID. Add workspace/account IDs to your keys where needed, plugin scope isn't workspace scope.
- For browser file settings, `await this.api.storedFileUrl('settingName')` returns a managed blob URL or `null`. Don't assume the setting contains a filesystem path. [CustomFonts](CustomFonts/index.ts) handles both desktop and browser files.
- `this.api.userAPI(method, params, { signal: this.api.signal })` calls Slack as the signed-in user. Params are strings or blobs; it returns parsed JSON and throws on API failure. These can be real account changes, depending on the method.
- `this.api.fetch(url, init)` uses the host bridge and returns `{ status, body }`, **not** a Fetch `Response`. Availability differs by host: the extension renderer deliberately disallows it. Use a supported privileged half when needed. Ordinary page `fetch` still follows browser CORS rules.

## When you actually need `main.ts`

The renderer runs in Slack's page. Node and Electron belong in the privileged half, default-exported as a `SlickMainPlugin`. Don't import `main.ts` from `index.ts`.

For example, `src/plugins/HelloSlick/main.ts`:

```ts
import type { SlickMainPlugin } from '$slick';
import { id } from './meta.ts';

export default {
  id,
  capabilities: [],
  rpc: {
    status(ctx) {
      return { enabled: ctx.settings.enabled };
    },
  },
} satisfies SlickMainPlugin;
```

The renderer can call `await this.api.main.call<{ enabled: boolean }>('status')`. RPC handlers receive `(ctx, args, sender)`, validate arguments and return serializable values. `ctx.emit(event, payload)` sends events back to `this.api.main.on(event, callback)`.

The full contract is [`shared/main.ts`](../shared/main.ts):

- `boot(ctx)` runs before Electron is ready. Register protocols and Chromium switches here!
- `ready(ctx)` runs after Electron is ready. Return a disposer for runtime resources.
- `window(ctx, window)` runs for Slack windows.
- `rpc` exposes named methods to this plugin's renderer.

Declare capabilities you use: `protocol`, `requests`, `frames`, `notifications`, `switches`, `shell`, `net`, `media`, `dialog`, `cookies`, or `secrets`. Undeclared use throws. These declarations help review privileged code; they are **not a sandbox**. Main-half resources aren't automatically scoped like renderer registrations: keep cleanup in the disposer returned by `ready()`. A renderer restart on settings changes doesn't restart the main half; use `ctx.onSettingsChange()` for host-side updates. Protocol plugins can have `boot()` called while disabled so their schemes are registered in time; keep normal runtime work in `ready()`.

[QuietSpotify](QuietSpotify/main.ts) demonstrates frame hooks and cleanup. [HcaStatus](HcaStatus/main.ts) demonstrates RPC and privileged networking. The generated `src/desktop/mainPlugins.generated.ts` is build output; don't edit it.

Browser support requires actual work because they want to be special little snowflakes.

- [`EXTENSION_PLUGINS`](../extension/plugins.ts) selects renderer plugins. `BACKGROUND_PLUGINS` separately selects privileged halves.
- Web builds use `browser.ts` when present, otherwise `main.ts`. The [extension host](../extension/mainHost.ts) supports only part of `MainCtx`; Electron APIs don't magically exist in Firefox.
- [`USERSCRIPT_PLUGINS` / `USERSCRIPT_MAIN_PLUGINS`](../userscript/plugins.ts) select the userscript halves. Userscript privileges come from its GM adapter, not Electron.
- `main.on` is currently a no-op in both web loaders. The desktop event example above doesn't provide browser event delivery.
- `this.api.loader` is `'electron'`, `'extension'`, or `'userscript'`. Use it when a feature needs a platform-specific path, and test each target you enable.

## Share it as a file

Testing plugins are quite important and this is the easiest way to share them without a full blown PR. You can build your plugin using the following:

```bash
bun run build:plugin src/plugins/YourPlugin # or any folder with an index.ts(x)
```

This will pop out `dist/plugins/YourPlugin.js` and `dist/plugins/YourPlugin.user.js`. On desktop, install the `.js` from **Slick Settings > Plugins > Install plugin...**; in the browser extension, use **Install plugin file…** under the Slick toolbar button's Plugins tab (Chromium also needs **Allow User Scripts** turned on in the extension's details page); with the userscript, install the `.user.js` in Violentmonkey next to Slick. If you try to install a newer file with the same `id`, it will just update it in place! **Remove plugin** under its cog uninstalls it and kerblams its data. The folder doesn't have to be in this repo since `$slick` resolves from anywhere.

For the sake of security, user plugins are renderer-only and may only import `$slick` and their own files (plus packages, which get bundled!) Trying to access Slick's internals or shipping a `main.ts` will throw an error.

On the web, user plugins run as user scripts (the extension's `userScripts` API or your userscript manager), so Slack's CSP never has to allow eval. Reload Slack after installing or removing one there.

## Debug it before declaring victory

Open DevTools on the Slack page and filter the console for `[slick]`. `this.log(...)` adds the plugin name. Preferences shows startup failures; after fixing one, rebuild/reload and toggle the plugin to retry.

Useful console helpers include `__slickPluginManager.info()`, `getComponent('Name')`, `getRenderedComponent('Name')`, `getComponentSource(component)`, `getExport(predicate)`, `getByProps(['exportName'])`, `getValueSource(value)`, `getStore()`, and `getRawState()`. They inspect the current Slack bundle, names you found six months ago aren't holy scripture and constantly change.

Before sending a patch:

1. Run the [local checks](../../DEVELOPMENT.md) and any focused tests for your plugin.
2. Enable it, exercise the feature, change settings, disable it, and enable it again.
3. Check channels, threads, workspace changes, and pop-outs if your plugin touches them.
4. Test the browser/userscript version if you added it to those lists. A desktop build doesn't prove that it works on Firefox.

Keep pure transforms in helper files with `node:test` tests; [ClearURLs](ClearURLs/clean.test.ts), [HumanCount](HumanCount/count.test.ts), and [NotShitMarkdown](NotShitMarkdown/markdown.test.ts) are good starting points. For renderer mocks, copy the approach in a nearby `index.test.ts`. Then actually use the thing for a bit. All green tests don't click buttons for you.
