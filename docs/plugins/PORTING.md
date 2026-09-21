# Porting a plugin to v2

Conventions every port follows. Read this before the per-plugin note.

## Layout

```
src/plugins/<Name>/
  meta.ts     id, pluginName, description, defaultEnabled, settings schema
  index.ts    the renderer half; `.tsx` if it renders anything
  main.ts     optional, privileged Electron work
```

`meta.ts` is imported by the renderer half, the main half and the build, so the
settings schema is declared exactly once. The build discovers plugins by
directory; nothing needs registering.

`meta.ts` shape:

```ts
import type { SettingsSchema } from '../../shared/settings.ts';

export const id = 'Example';            // must match the directory name
export const pluginName = 'Example';
export const description = '…';
export const defaultEnabled = false;

export const settings = { … } as const satisfies SettingsSchema;
```

Setting types: `boolean` · `number` · `text` · `select` · `color` · `file` ·
`names`. `enabled` is reserved and never declared.

`index.ts` shape:

```ts
import { SlickPlugin } from '$slick';
import * as meta from './meta.ts';

export default class Example extends SlickPlugin<typeof meta.settings> {
  static readonly id = meta.id;
  static readonly pluginName = meta.pluginName;
  static readonly description = meta.description;
  static readonly defaultEnabled = meta.defaultEnabled;
  static readonly settings = meta.settings;
  static readonly liveSettings = ['someKey'];

  start() {}
  stop() {} // only for what the API did not dispose
  onSettingsChange(changed: string[]) {}
}
```

The class must be the **default export** and must be named, or the bundler
rejects it.

## Lifecycle

`start()` runs before Slack has finished booting and is time-boxed at 5s. Only
fast local work belongs in it; anything slower is background work cancelled
through `this.api.signal`.

Every registration made through `this.api` is tracked and reversed
automatically when the plugin stops. `stop()` is for things the API did not
hand a disposer back for, which should be almost nothing — a timer, a listener
added directly to `document`.

A setting listed in `liveSettings` mutates `this.config` in place and calls
`onSettingsChange`. Anything else stops and restarts the plugin.

## The API

| Area       | Members                                                                                                                                                                                |
| ---------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Discovery  | `getExport` `waitForExport` `getByProps` `getComponent` `waitForComponent` `getRenderedComponent` `waitForRenderedComponent` `getComponentSource` `getValueSource` `getFiberFromNode`  |
| Components | `patchComponent(matcher, Original => props => JSX)`                                                                                                                                    |
| Redux      | `redux.patchSlice` `mapEntries` `patchState` `patchThunk` `dispatchThunk` `getThunkCreator` `waitForThunkCreator` `getStore` `getRawState` `refresh` `useReduxState` `usePatchVersion` |
| Slack      | `members.*` `messages.*` `channels.*` `blocks.*` `files.upload` `rtm.on` `onMessageSendDelta`                                                                                          |
| UI         | `setStyle(css, key?)` `elements.*` `menu.Menu` `modal.openModal/confirm/alert` `onDocument`                                                                                            |
| Lifecycle  | `storage` `Cache` `settings.set` `signal` `fetch` `userAPI` `main.call/on` `log`                                                                                                       |

`React` is a global — Slack's own instance. Never import react.

## The five traps

1. **`state.messages` nests two levels**: `messages[channelId][ts]`. A
   single-level `patchSlice('messages', …)` receives a channel bucket, not a
   message. It compiles, runs, and does nothing.

2. **`redux.refresh()` after a live settings change.** `mapEntries` memoizes
   per entry keyed on the patch version, so a `patchSlice` closure reading
   `this.config` keeps serving results computed from the old settings.

3. **`redux.usePatchVersion()` in any component that renders patched data.**
   Slack's `connect` memoizes off the raw state, so it never re-runs for a
   read-time patch and the component updates only by coincidence.

4. **Never mutate Slack's state.** Slick transforms on read. `getRawState()`
   must always return the original;
   `getRawState().messages[ch][ts].text` staying unmodified is a test.

5. **`Object.keys(slice)` lies.** Several slices — `messages`, `channels`,
   `members`, `view`, `presence` — keep their real keys on the object's
   **prototype**, so `Object.keys` reports 0 for a slice holding tens of
   thousands of entries. This has produced three wrong conclusions in this
   project already. `mapEntries` handles it; direct reads must walk the
   prototype.

## Things to prefer

- **Props over DOM.** If Slack passes the data to a component, patch the
  component. Do not read it back out of the fiber.
- **Props over CSS for anything conditional.** v1 hid composer buttons with
  `button[aria-label="Emoji"]`, which breaks silently in every language other
  than English.
- **`redux.patchSlice` over a component patch** when the data is in the store:
  one patch covers every surface that reads it, including ones nobody thought
  about.
- **Names in `docs/slack-internals.md`.** Every `displayName` and thunk name a
  plugin depends on goes in that file, so a Slack rename is a one-file fix.
- **A visible failure over a silent one.** If a patch depends on a shape Slack
  could change, assert the shape and warn once. Deleted messages quietly
  ceasing to appear is worse than a console error.

## Verification

```
npm run typecheck && npm run lint && npm run fmt:check && npm run build && npm run test:app
```

Pure logic (a parser, a matcher, a formatter) goes in its own module with
`node --test` coverage, added to the `test:app` glob in `package.json`. It is
the only part of a plugin testable without a running Slack, so it is worth
separating for that reason alone.

Then, against a live client: the plugin takes effect, its live settings apply
without a restart, and disabling it actually reverts what it did.
