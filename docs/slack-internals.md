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

### The slices keep their real keys on the prototype

**`Object.keys(slice)` returns 0 for a fully populated slice.** Slack builds
several store slices as an object whose own properties are empty and whose
**prototype** carries the entries. Measured on **Slack 4.52.162**, from the
packaged build against a real signed-in session:

| slice            | `Object.keys()` | real keys                          |
| ---------------- | --------------- | ---------------------------------- |
| `messages`       | 0               | **622 channels / 85,977 messages** |
| `channels`       | 0               | 1,766                              |
| `members`        | 0               | 1,632                              |
| `view`           | 0               | 80                                 |
| `presence`       | 0               | 15                                 |
| `channelHistory` | 1,932           | 1,932                              |

Read them like this:

```ts
const own = Object.keys(slice);
const proto = Object.getPrototypeOf(slice);
const keys = [...own, ...(proto && proto !== Object.prototype ? Object.keys(proto) : [])];
```

`channelHistory` is a plain object, so both forms agree — which is exactly why
this is easy to miss. A probe that checks one slice and finds it sane concludes
the store is fine.

**This has caused three wrong conclusions in this project already**: that
message bodies were unreachable, that the slice was empty because the window
was unfocused, and that only `customStatus` was message-shaped. All three were
one `Object.keys` call on a prototype-keyed object.

`api.redux.mapEntries` handles this correctly — it proxies `getPrototypeOf` and
runs entries through the prototype proxy — so `patchSlice` works on these
slices. Only direct reads need care.

## State shape: messages, confirmed

`state.messages[channelId][ts]` holds message objects, and a sample from a live
client looks like:

```
messages[C08HH2NSXC7][1789659565.070200]
  text (string)  blocks  attachments  files  thread_ts  reply_count  replies
  reply_users  latest_reply  is_ephemeral  source_team_id  blocksProcessed
```

So `text` is a real string on the message, `blocks` is present, and the nesting
is two levels as documented above.

### The activity feed does not read `messages`

`ActivityItem` is handed its own message payload rather than reading the store,
so a `patchSlice('messages')` does not cover the activity feed. Anything
rewriting message content needs an `ActivityItem` patch as well. Search is the
same story, through `MessageListItem`.

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

## Confirmed rendering on Slack 4.52.162

A packaged run against a real signed-in session, sitting on the activity feed,
saw these actually render. `getRenderedComponent` only knows what has rendered,
so this is evidence of presence, never of absence.

| name                                                               | used by                                 |
| ------------------------------------------------------------------ | --------------------------------------- |
| `Reaction`, `ReactionAnimation`                                    | WhoReacted                              |
| `ReactionBar`, `ReactionAddButton`                                 | CopyReacted                             |
| `BroadcastPreamble`                                                | UserPronouns                            |
| `MessageWrapper`, `ActivityItem`, `Blocks`                         | ShowRealUser, MessageLogger, Censorship |
| `BaseMessageSender`                                                | HcaStatus                               |
| `MessageBackground`                                                | StreamerMode                            |
| `TextyButtons`                                                     | SlimMessageBox                          |
| `MessagePaneInput`                                                 | SilentTyping, `onMessageSendDelta`      |
| `HelpButton`                                                       | StreamerMode's toggle                   |
| `MenuTrigger`, `Button`, `Tooltip`, `Label`, `ConnectedBaseAvatar` | the elements registry                   |

Not yet seen rendering, because that run never opened a thread, menu, modal,
search or the composer's edit mode: `ThreadSenderAndTimestampGeneric`,
`ThreadRootGeneric`, `RimetoMemberProfileOverflowMenu`, `MenuFromTemplate`,
`MessageListItem`, `InputContainer`, `BaseEditMessage`, `EditAudioButton`,
`SvgIcon`, `ConfirmationModal`, `FormTextInput`, `InlineAlert`,
`MrkdwnElement`. These are the names to re-check first if a plugin looks inert.

Thunk creators confirmed resolving by name: `ensureMembersArePresent`
(members batching), `addAndUploadPendingFile` (`files.upload`), `openModal`
(the modal API), `showNotification`.

## Names in use

Filled in as plugins are ported. Each row should say which plugin depends on it
and how it was identified, so a break is diagnosable without re-deriving it.

| Name                                                 | Kind          | Used by                                | How it was found                                                                                                                 |
| ---------------------------------------------------- | ------------- | -------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| `createStore`                                        | redux export  | core (`src/app/slack/redux.ts`)        | named function export, wrapped via `patchExportFunction`                                                                         |
| createThunk module                                   | thunk factory | core (`src/app/slack/redux.ts`)        | signature: the same module exports a kind enum with `Thunk: 'Thunk'` and `Fetcher: 'Fetcher'`                                    |
| `.p-client_container`                                | DOM anchor    | core (redux store + fiber root lookup) | stable Slack client container class                                                                                              |
| `currentUserStartedTyping`                           | thunk         | `SilentTyping`                         | present in the thunk registry; confirmed by dumping all 4,994 names                                                              |
| `currentUserEndedTyping`                             | thunk         | `SilentTyping`                         | as above                                                                                                                         |
| `routeMessages`                                      | named export  | core (`src/app/slack/rtm.ts`)          | named function export; Slack routes every socket payload through it                                                              |
| `handleMessageImmediatelyWithoutPreprocessing`       | thunk         | core (`src/app/slack/rtm.ts`)          | degraded-mode path that skips `routeMessages`; present in the thunk registry                                                     |
| `state.messages[channelId][ts]`                      | redux slice   | `MessageLogger`, `Censorship`          | Taut `getRawMessage`; two-level map, bodies not timestamps. Also ShowRealUser                                                    |
| `state.channelHistory[key].slices[].timestamps`      | redux slice   | `MessageLogger` via `injectMessages`   | Slack renders from this array, not by enumerating `messages`; key is `channelId` or `channelId-threadTs`                         |
| `MessageWrapper`                                     | component     | `MessageLogger`                        | Taut ShowRealUser patches this with `props.msg`; channel message row                                                             |
| `ThreadRootGeneric`                                  | component     | `MessageLogger`                        | as above; thread parent row                                                                                                      |
| `MessageActionsMenu`                                 | component     | `MessageLogger`                        | opened a message's three-dots menu and dumped the newly rendered names; props `{channelId, ts, threadTs, onTriggerClose}`        |
| `Menu`                                               | component     | `MessageLogger`                        | Slack's generic menu body. It builds the message menu from redux selectors, not a template prop, so extra rows go in as children |
| `Tabs`                                               | component     | core (`src/app/settings.tsx`)          | Preferences **and** the sidebar rail render through it; the Preferences instance is told apart by its section ids (below)        |
| `MessageListItem`                                    | component     | `Censorship`                           | Taut ShowRealUser; search result row with `props.result.messages` (search copies never hit `messages`)                           |
| `MessagePaneInput`                                   | component     | `bChannel`, `onMessageSendDelta`       | confirmed rendering; `props.prepareAndSendMessage({ delta, channelId, … })`                                                      |
| `InputContainer`                                     | component     | `bChannel`, `onMessageSendDelta`       | thread composer; same send prop as `MessagePaneInput`                                                                            |
| `TextyAutocomplete`                                  | component     | `bChannel`                             | **Not yet seen rendering.** v1 composer integration; `includeAllBroadcastKeywords` enables `@channel`                            |
| `convertDeltaToBlocks`                               | named export  | core (`src/app/slack/blocks.ts`)       | v1 `DiPi.A`; identified by export name. `api.blocks.fromDelta`                                                                   |
| `getChannelPrefByApi` / `getChannelPref`             | thunk         | `bChannel`                             | **CANDIDATE, unverified.** Replaces v1 `M9P0.Kn`. Tried at runtime; falls back to `conversations.getPrefs`                       |
| `setChannelPrefsByApi` / `setChannelPrefs`           | thunk         | `bChannel`                             | **CANDIDATE, unverified.** Replaces v1 `Tid6.y`. Tried at runtime; falls back to `conversations.setPrefs`                        |
| `inviteUsersToChannelByApi` / `inviteUsersToChannel` | thunk         | `bChannel`                             | **CANDIDATE, unverified.** Replaces v1 `M9P0.Cw`. Tried at runtime; falls back to `conversations.invite`                         |
| `conversations.invite` / `getPrefs` / `setPrefs`     | userAPI       | `bChannel`                             | durable fallback when the thunk names are absent. `already_in_channel` means the bot is a member                                 |

> **On the bChannel rows marked CANDIDATE.** Nothing has confirmed these
> against a running client. The plugin tries each name, logs when it is absent,
> and falls back to the documented Web API — which is why it works regardless.
> They are recorded here as leads to confirm, not as identified names. Confirm
> with `thunkNames()` on a focused client and then rewrite the row.

### Preferences tab ids

`src/app/settings.tsx` adds the Slick tab to the `Tabs` instance whose ids it
recognises. Read off `props.tabs` on a live client (Slack 4.52.155):

| list         | ids                                                                                                                                                                                                                                |
| ------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Preferences  | `availability`, `notifications`, `vip`, `tab_rail`, `sidebar`, `themes`, `messages_media`, `language_region`, `accessibility`, `mark_as_read`, `video_audio`, `salesforce`, `connected_accounts`, `privacy_visibility`, `advanced` |
| sidebar rail | `home`, `dms`, `activity-inbox`, `unified-files`, `later`, `platform`                                                                                                                                                              |

The two sets do not overlap, which is what the patch relies on. Matching on
`advanced` alone is not enough — it identifies Preferences but not _only_
Preferences once the check is relaxed, and a Slick tab then appears on the rail.
If Slack renames most of these, `settings.tsx` logs once and adds no tab.

## CSS class names in use

Class names are a weaker contract than component names -- Slack regenerates
them -- so nothing load-bearing may depend on one. Each row must say what
happens when it stops matching.

| Selector                                                                                                                                 | Used by                                         | What it is                                                                                                                                                                                     | If it stops matching                                                                                   |
| ---------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| `.p-ia4_top_nav__left_container`                                                                                                         | `Snappy`                                        | the top nav's left pane, whose `flex-basis` Slack sets from JS                                                                                                                                 | resize gating still works; the top nav holds its width for the length of a drag instead of tracking it |
| `.p-member_profile_hover_card__container_deleted`                                                                                        | `themes/amoled.json`, `themes/ultraviolet.json` | the body of the profile hover card for a deactivated account. Slack paints it from `--sk_foreground_min_solid` (`#222529`), a dual-use token the themes deliberately do not override wholesale | the card goes back to Slack's grey panel against the theme's background. Nothing else changes          |
| `.p-member_profile_hover_card__banner_deactivated_dark` / `_light`, `.p-member_profile_restriction_deleted`, `.c-avatar` inside the card | as above                                        | the "Deactivated account" strip on the hover card and on the profile pane, plus the card's avatar, all painted from `--sk_foreground_low_solid` (`#35373b`)                                    | the strip and the avatar placeholder stay a lighter grey than the rest of the client                   |
| `.c-menu_item__li`, `.c-menu_item__button`, `.c-menu_item__label`                                                                        | `MessageLogger`                                 | Slack's menu-row markup, reproduced for the rows the plugin appends to the message overflow menu                                                                                               | the rows still render and still work; they lose Slack's padding, hover and type                        |

## Still to identify

These gate the Group C and D plugin ports and need a live discovery session:

| Needed for            | What is missing                                                                                                                                                                                             |
| --------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `HcaStatus`           | the member hover-card, member-list and search-result anchors                                                                                                                                                |
| `Click2Load`          | the message-embed iframe wrapper component                                                                                                                                                                  |
| `CustomSounds`        | the module that plays notification audio                                                                                                                                                                    |
| `bChannel` (live)     | confirm the thunk names above against `thunkNames()` on a focused client. The plugin already falls back to `userAPI` if they are absent                                                                     |
| `NoTrack` (page half) | the telemetry factory modules. `getGenericTracer`, `getGenericTelemeter` and `getNoopTelemeter` are **not** thunk creators here, so they must be found as module exports via `getExport`/signature matching |

## Verifying a name before you rely on it

A plugin that patches a name Slack does not have starts cleanly, logs happily,
and does nothing. Before shipping a patch, confirm the target exists:

```js
thunkNames().includes('someThunk')            // thunk creators (4,994 of them)
[...__slickRenderedComponents.keys()]         // components that have rendered
Object.keys(getRawState().someSlice ?? {}).length   // is the slice populated?
```
