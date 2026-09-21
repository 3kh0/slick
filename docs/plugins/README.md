# Plugin handoff notes

One note per plugin that is not yet ported to v2 and needs more than a
mechanical translation. Each is written to be picked up cold: what the plugin
does, why v1's approach is being replaced, the traps, and how to verify it.

| Plugin                            | Status                                                 | Notes                                                                                                                                                               |
| --------------------------------- | ------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [Censorship](Censorship.md)       | Attempted and reverted — patched the wrong slice shape | Mask configured words. Needs a two-level `messages` patch and a scope decision about non-message surfaces.                                                          |
| [MessageLogger](MessageLogger.md) | Not started — long pole                                | Keep deleted and edited messages visible. Needs the `injectMessages` helper ported first; `channelHistory` must be patched alongside `messages` or nothing renders. |

Before starting either, read `../slack-internals.md`. Both depend on the shape
of the `messages` slice, and both have a failure mode where the plugin starts
cleanly, logs happily, and does nothing at all.

Ported plugins live in `src/plugins/<Name>/`:
`index.ts` (renderer half), `meta.ts` (id, name, description, defaultEnabled,
settings schema — shared by both halves and the build), and an optional
`main.ts` for privileged Electron work.
