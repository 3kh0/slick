# Plugin handoff notes

Notes for plugins that needed more than a mechanical translation. Each is
written to be picked up cold: what the plugin does, why v1's approach was
replaced, the traps, and how to verify it.

| Plugin                            | Status | Notes                                                                                                                                                       |
| --------------------------------- | ------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [Censorship](Censorship.md)       | Ported | Mask configured words in message bodies (two-level `messages` patch) and search (`MessageListItem`). Channel/member names are out of scope.                 |
| [MessageLogger](MessageLogger.md) | Ported | Keep deleted and edited messages visible. Uses `api.rtm`, `api.messages.injectMessages`, `api.storage`, and a `MessageWrapper` / `ThreadRootGeneric` patch. |

Both depend on the shape of the `messages` slice — see `../slack-internals.md`.
A single-level `patchSlice('messages', …)` starts cleanly, logs happily, and
does nothing at all.

Ported plugins live in `src/plugins/<Name>/`:
`index.ts` (renderer half), `meta.ts` (id, name, description, defaultEnabled,
settings schema — shared by both halves and the build), and an optional
`main.ts` for privileged Electron work.
