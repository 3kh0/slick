# Slack internals Slick depends on

Every Slack-private name Slick patches belongs in this file. They are not a
public contract: Slack can rename a component or reshape a slice in any release,
and when that happens the fix should be a one-file change here rather than a
hunt through 29 plugins.

## What is known to hold

Verified against **Slack 4.52.155** (Electron 44, rspack build), 2026-09-21.

- Slack ships `displayName` on its production components. A run of the client
  surfaced **613 distinct component names** within twelve seconds of boot, so
  name-based patching is viable.
- Both `webpackChunkwebapp` and `rspackChunkwebapp` are hooked. Slack is on
  rspack now, but the webpack global still has to be covered.
- A boot of the client initializes about **4,400 modules**.
- Components seen early include `SvgIconPrimitive`, `MessageSender`-family
  components, `Provider`, `ClientStoreProvider`, `MainWindowClient`,
  `MultiTeamClient`, and a long tail of `Connect(...)`-wrapped containers.

## Finding a name

`slick.js` exposes the discovery helpers on `globalThis` in every build, so
open DevTools (`Cmd`/`Ctrl`+`Alt`+`I`) on the Slack window and use them:

```js
// Everything that has rendered so far, by displayName
[...__slickRenderedComponents.keys()]

// Every module export the registry has seen
allExports()

// Find by shape rather than name -- more durable
getExport((e) => typeof e === 'function' && /someDistinctiveString/.test(e.toString()))
getByProps(['someMethod', 'anotherMethod'])

// Read the original source of whatever exported a value
getValueSource(someExport)
getComponentSource(SomeComponent)
```

Prefer a **filter** over a name for anything load-bearing:
`patchComponent({ filter: (c) => 'memberId' in (c.defaultProps ?? {}) }, ...)`
survives a rename; `patchComponent('RimetoMemberProfileOverflowMenu', ...)`
does not.

## Names in use

Filled in as plugins are ported. Each row should say which plugin depends on it
and how it was identified, so a break is diagnosable without re-deriving it.

| Name | Kind | Used by | How it was found |
| ---- | ---- | ------- | ---------------- |
| `createStore` | redux export | core (`src/app/slack/redux.ts`) | named function export, wrapped via `patchExportFunction` |
| createThunk module | thunk factory | core (`src/app/slack/redux.ts`) | signature: the same module exports a kind enum with `Thunk: 'Thunk'` and `Fetcher: 'Fetcher'` |
| `.p-client_container` | DOM anchor | core (redux store + fiber root lookup) | stable Slack client container class |

## Still to identify

These gate the Group C and D plugin ports and need a live discovery session:

| Needed for | What is missing |
| ---------- | --------------- |
| `HcaStatus` | the member hover-card, member-list and search-result anchors |
| `Click2Load` | the message-embed iframe wrapper component |
| `CustomSounds` | the module that plays notification audio |
| `BetterCaptions` | the huddle/call container to mount the overlay in |
| `bChannel` | four modules addressed by literal id in v1 (`eh+y`, `M9P0`, `DiPi`, `Tid6`). `DiPi.A` is `convertDeltaToBlocks`; the other three must be re-found as named thunks via `waitForThunkCreator` |
