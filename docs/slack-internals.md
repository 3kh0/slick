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
- The redux store carries **412 slices**, and the thunk registry resolves
  **4,994 named thunk creators** -- so `waitForThunkCreator(name)` is a solid
  way to address Slack's actions without touching a module id.

## State shape: messages

**`state.messages[channelId][ts]` holds message objects** -- nested one level
deeper than most slices. Taut's `getRawMessage` reads exactly this, and its
ShowRealUser patches the slice two levels deep:

```ts
patchSlice('messages', (channelId, bucket) => mapEntries(bucket, (ts, msg) => transform(msg, channelId, ts)));
```

A single-level `patchSlice('messages', (id, msg) => ...)` is therefore wrong:
the entry it receives is a _channel bucket_, not a message. That mistake
compiles, runs, and silently does nothing.

### Caveat: the slice is empty until the client really loads a conversation

In unattended runs of `npm run desktop:dev` (window opened but never focused),
`state.messages` stayed empty for the whole session, and so did `channels`,
`members` and `view` -- while `experiments` (1857), `channelCursors` (1076) and
`channelLatests` (1076) filled normally. `channelHistory[channelId].slices`
carries only `{ timestamps, start, end }`, never bodies.

So an empty `messages` does **not** mean Slack stopped using it; it means that
client never got far enough to load one. Verify message-shaped work with a
focused window on an open channel, and treat "the slice is empty" as a probe
problem until proven otherwise. An earlier pass here concluded message bodies
were unreachable, purely because the probe read an unpopulated store.

## Finding a name

`slick.js` exposes the discovery helpers on `globalThis` in every build, so
open DevTools (`Cmd`/`Ctrl`+`Alt`+`I`) on the Slack window and use them:

```js
// Everything that has rendered so far, by displayName
[...__slickRenderedComponents.keys()];

// Every module export the registry has seen
allExports();

// Find by shape rather than name -- more durable
getExport((e) => typeof e === 'function' && /someDistinctiveString/.test(e.toString()));
getByProps(['someMethod', 'anotherMethod']);

// Read the original source of whatever exported a value
getValueSource(someExport);
getComponentSource(SomeComponent);
```

Prefer a **filter** over a name for anything load-bearing:
`patchComponent({ filter: (c) => 'memberId' in (c.defaultProps ?? {}) }, ...)`
survives a rename; `patchComponent('RimetoMemberProfileOverflowMenu', ...)`
does not.

## Names in use

Filled in as plugins are ported. Each row should say which plugin depends on it
and how it was identified, so a break is diagnosable without re-deriving it.

| Name                                            | Kind          | Used by                                | How it was found                                                                                         |
| ----------------------------------------------- | ------------- | -------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| `createStore`                                   | redux export  | core (`src/app/slack/redux.ts`)        | named function export, wrapped via `patchExportFunction`                                                 |
| createThunk module                              | thunk factory | core (`src/app/slack/redux.ts`)        | signature: the same module exports a kind enum with `Thunk: 'Thunk'` and `Fetcher: 'Fetcher'`            |
| `.p-client_container`                           | DOM anchor    | core (redux store + fiber root lookup) | stable Slack client container class                                                                      |
| `currentUserStartedTyping`                      | thunk         | `SilentTyping`                         | present in the thunk registry; confirmed by dumping all 4,994 names                                      |
| `currentUserEndedTyping`                        | thunk         | `SilentTyping`                         | as above                                                                                                 |
| `routeMessages`                                 | named export  | core (`src/app/slack/rtm.ts`)          | named function export; Slack routes every socket payload through it                                      |
| `handleMessageImmediatelyWithoutPreprocessing`  | thunk         | core (`src/app/slack/rtm.ts`)          | degraded-mode path that skips `routeMessages`; present in the thunk registry                             |
| `state.messages[channelId][ts]`                 | redux slice   | `MessageLogger`, `Censorship`          | Taut `getRawMessage`; two-level map, bodies not timestamps. Also ShowRealUser                            |
| `state.channelHistory[key].slices[].timestamps` | redux slice   | `MessageLogger` via `injectMessages`   | Slack renders from this array, not by enumerating `messages`; key is `channelId` or `channelId-threadTs` |
| `MessageWrapper`                                | component     | `MessageLogger`                        | Taut ShowRealUser patches this with `props.msg`; channel message row                                     |
| `ThreadRootGeneric`                             | component     | `MessageLogger`                        | as above; thread parent row                                                                              |
| `MessageListItem`                               | component     | `Censorship`                           | Taut ShowRealUser; search result row with `props.result.messages` (search copies never hit `messages`)   |

## Still to identify

These gate the Group C and D plugin ports and need a live discovery session:

| Needed for            | What is missing                                                                                                                                                                                             |
| --------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `HcaStatus`           | the member hover-card, member-list and search-result anchors                                                                                                                                                |
| `Click2Load`          | the message-embed iframe wrapper component                                                                                                                                                                  |
| `CustomSounds`        | the module that plays notification audio                                                                                                                                                                    |
| `BetterCaptions`      | the huddle/call container to mount the overlay in                                                                                                                                                           |
| `bChannel`            | four modules addressed by literal id in v1 (`eh+y`, `M9P0`, `DiPi`, `Tid6`). `DiPi.A` is `convertDeltaToBlocks`; the other three must be re-found as named thunks via `waitForThunkCreator`                 |
| `NoTrack` (page half) | the telemetry factory modules. `getGenericTracer`, `getGenericTelemeter` and `getNoopTelemeter` are **not** thunk creators here, so they must be found as module exports via `getExport`/signature matching |

## Verifying a name before you rely on it

A plugin that patches a name Slack does not have starts cleanly, logs happily,
and does nothing. Before shipping a patch, confirm the target exists:

```js
thunkNames().includes('someThunk')            // thunk creators (4,994 of them)
[...__slickRenderedComponents.keys()]         // components that have rendered
Object.keys(getRawState().someSlice ?? {}).length   // is the slice populated?
```
