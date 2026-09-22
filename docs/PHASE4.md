# Phase 4: settings tab, themes, and the CSS editor

The last user-facing gap in v2. Today settings are edited by hand in
`settings.json`, themes do not load at all, and there is no CSS editor.

Read `docs/plugins/PORTING.md` first for the API surface and the five traps.

---

## 1. Themes — `src/app/theme.ts`

### The format does not change

`themes/*.json`, two of them today (`amoled.json`, `ultraviolet.json`):

```jsonc
{
  "name": "AMOLED",
  "description": "True-black theme for OLED.",
  "palette": { "aubergine": { "0": "0,0,0", "10": "0,0,0" } },
  "sidebar": {/* optional */},
  "vars": { "--dt_color-base-pry": "#000000" },
  "css": ["body::before{…}", "…"],
}
```

### How it becomes CSS

A direct port of `scripts/theme.js`'s `buildSpec` plus `inject.js:148-155`:

- `palette[ramp][shade]` → `--dt_color-plt-<ramp>-<shade>`
- `sidebar[key]` → `--p-team_sidebar__<key>`
- `vars` merge in last and win
- every variable is emitted with `!important`, under this exact selector:
  `:root,html,body,.sk-client-theme--dark,.sk-client-theme--light`
- `css` (array joined with newlines, or a string) is appended verbatim

Apply it with `setStyle(css, 'theme')` from `src/app/api/css.ts`, which already
handles multiple documents.

### Where the theme files come from

**Bake them into the app bundle at build time**, exactly as plugins already
are: `scripts/build/app.ts` has a `__SLICK_PLUGINS__` define built by
`bundleAllRenderers`. Add `__SLICK_THEMES__` the same way — a
`Record<string, ThemeJson>` keyed by file basename, read from `themes/*.json`.

Reasons, in order: the two theme files are ~75 lines total; Slick is
embedded-only, so a runtime fetch is a step backwards; and it means the theme
applies with no async gap at boot, which is what stops the unthemed flash v1
had.

Declare `__SLICK_THEMES__` in `src/globals.d.ts` alongside the others.

### Selection

The active theme is already modelled: `StoredConfig.theme` in
`src/app/configStore.ts`. Three states:

| value            | meaning                                      |
| ---------------- | -------------------------------------------- |
| `''` or absent   | stock Slack, no theme                        |
| a theme basename | that theme                                   |
| `'custom'`       | the user stylesheet only (see `readUserCss`) |

The user stylesheet is applied independently of the theme and always — it is
`configStore.getUserCss()` with `onUserCssChange`, and it is already wired.

Changing the theme must apply **without a reload**. `configStore.onConfigChange`
already fires on a settings write.

---

## 2. The settings tab — `src/app/settings.tsx`

### What it replaces

`scripts/byoe/settings-renderer.js` (593 lines) appended a tab button into
`.p-prefs_dialog__menu` and positioned a `position: fixed` overlay over
`.p-prefs_dialog__panel`, re-syncing it on every DOM tick with
`getBoundingClientRect()` and copying computed styles across. All of that goes
away: with React patching, this is a real tab.

### How

Patch Slack's `Tabs` component and append one. Taut's `app/settings.tsx` is
the reference (728 lines — it does more than this needs). The shape:

```tsx
patchComponent<TabsProps>('Tabs', (Original) => (props) => {
  const tabs = [...props.tabs];
  // Only in the Preferences dialog, identified by its own last tab.
  if (tabs.at(-1)?.id === 'advanced') {
    tabs.push({ id: 'slick', label: <>Slick</>, content: <SlickSettings … />, svgIcon: { name: 'code' } });
  }
  return <Original {...props} tabs={tabs} />;
});
```

The `advanced` check matters: `Tabs` is a generic component Slack uses in
several dialogs, and without it the tab turns up in unrelated places.

### Sections

**Plugins.** One row per plugin from `pluginManager.info()`, which already
returns `{ id, name, description, authors, settings, running, enabled }`.
Each row: an enable toggle, and when expanded, a control per schema entry.
Toggle writes through `configStore.setPluginEnabled`, a setting through
`configStore.setPluginSetting`. Both already exist and already reconcile the
running plugin without a reload — do not add a restart prompt.

Controls by setting type, using `api/elements.ts`:

| type      | control                                                                                                                     |
| --------- | --------------------------------------------------------------------------------------------------------------------------- |
| `boolean` | `Checkbox`                                                                                                                  |
| `number`  | `FormTextInput`, coerced                                                                                                    |
| `text`    | `FormTextInput`                                                                                                             |
| `select`  | `BasicSelect` with the schema's `options`                                                                                   |
| `color`   | a colour input; Slack has no themed one, so a plain `<input type="color">` is fine                                          |
| `file`    | a button opening a native picker, honouring the schema's `accept`                                                           |
| `names`   | a read-only list with a remove button per entry (Nicknames is the only user; it is written from the profile menu, not here) |

A setting whose schema says `restartRequired`, or that appears in the plugin's
`relaunchSettings`, needs a visible "restart Slick to apply" note. Do not
silently do nothing.

**Appearance.** A theme picker (None, each bundled theme, Custom) writing
`StoredConfig.theme`, and a button that opens the CSS editor window.

**About.** `__SLICK_VERSION__` and `__SLICK_BUILD__`, already defined.

### The file picker

`file` settings need a native dialog, which only the main process can open.
`MainCtx` already declares a `dialog` capability with `openFile`, but that is
per-plugin and this is core UI, so add a core `slick:rpc` method in
`src/desktop/bridge.ts` next to `readSettings`/`writeUserCss` rather than
inventing a plugin channel for it. Follow the existing methods table exactly:
it validates the sender and refuses anything not an own property.

---

## 3. The CSS editor — `src/desktop/windows/cssEditor.ts`

A port of `scripts/byoe/custom-css-window.js` (152 lines, and it works), with
**one change: Monaco is bundled, not loaded from `cdn.jsdelivr.net`.** Today
the editor is dead offline or behind a CDN block, and it is the last place
Slick fetches code at runtime — which contradicts the embedded-only rule the
rest of the app follows.

`monaco-editor@0.56.0` is already a devDependency, matching the version v1
pinned.

### Bundling

`node_modules/monaco-editor/min/vs` is the AMD build the CDN was serving, and
it is what `custom-css-window.js` already expects — so the editor HTML barely
changes, only its `baseUrl`. It is 24MB whole, almost all of it language
definitions for languages this editor will never open.

**Copy only what a CSS editor needs**, from `scripts/build/desktop.ts`, into
the staged app and then through `extraResources` in `scripts/build/package.ts`
(both already exist and already do this for `slick.js` and `themes`). Work out
the minimum set by loading the editor and watching what it requests; expect
roughly `loader.js`, `editor/`, `base/`, the CSS language contribution, and
the codicon font. State the final size in your report.

If trimming proves fiddly, copying all of `min/vs` is an acceptable first cut —
say so rather than shipping a broken editor — but the language definitions are
genuinely dead weight.

### Loading it

The window is `BrowserWindow` + a preload, over the existing
`slick-custom-css:{ready,save}` IPC channels. Keep the debounce (300ms), the
Cmd/Ctrl-S binding, the save-on-`beforeunload`, and the status toast — they are
all in the v1 file and they all work.

The CSP in the editor HTML currently allows `https://cdn.jsdelivr.net`. With
Monaco local, **that entire allowance disappears**: the editor should permit
`'self'` and nothing remote. That tightening is the main security win here, so
do not leave the old CSP in place.

Saving writes through the same path `writeUserCss` uses, so the change reaches
the client live through `onUserCssChange`.

---

## Verification

1. Set `"theme": "amoled"` in `settings.json` while running: the client goes
   black without a reload. Set it back to `""`: it returns to stock.
2. Open Preferences: a "Slick" tab is present, after Advanced. Open some other
   Slack dialog that uses tabs: no Slick tab.
3. Toggle a plugin from the tab: it starts or stops immediately, and the
   console shows the lifecycle line. No reload.
4. Change a live setting (Censorship's `terms` is the easiest): it applies
   without the plugin restarting.
5. Change a `relaunchSettings` key (Snappy's switches): the restart note
   appears.
6. Open the CSS editor **with the network disabled**: it loads. This is the
   whole point of bundling Monaco.
7. Type CSS, wait for the debounce: the client restyles live.
8. `npm run build && node scripts/build.ts package`, then launch the packaged
   app and repeat 1, 2 and 6 — resources resolve differently there than in the
   dev stage, and that is exactly where a path bug shows up.
