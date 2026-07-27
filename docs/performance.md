# Performance testing

Slick includes three complementary performance tools:

- A lightweight runtime recorder and user-triggered diagnostic export.
- A CDP benchmark runner that compares stock Slack with Slick using disposable clones of a dedicated fixture profile.
- A fixture-free boot bench that times Slick's main-process startup work in plain Node.

None of them upload data. The benchmark never edits the fixture profile or a normal Slack/Slick profile.

## Which tool to reach for

| Question                           | Tool                                                  |
| ---------------------------------- | ----------------------------------------------------- |
| Did my change make boot cheaper?   | `npm run perf:bootbench` — seconds, no Slack needed   |
| Is Slick slower than stock Slack?  | `npm run perf:benchmark` — needs a fixture profile    |
| Why is _this user's_ install slow? | Their diagnostic export, then `perf:benchmark bisect` |

## Diagnostic exports

Open **Preferences → Slick → Performance diagnostics → Export diagnostics…**. The saved JSON contains:

- Slick, Slack runtime, Electron, Chrome, OS, architecture, memory, and GPU facts.
- The enabled plugin names and active theme name, but no plugin setting values or custom CSS.
- The last ten structured sessions, including startup, long-task, input, event-loop stall, CPU/memory, renderer failure, and per-plugin DOM callback aggregates.

The export excludes full URLs, Slack workspace/team/channel/user IDs, tokens, cookies, messages, filenames, custom CSS, and plugin-setting values. It is written with owner-only permissions where the platform supports them.

## Create a fixture profile

Use a dedicated test account and workspace. Create a new empty directory and launch stock Slack once with that directory as its user data directory, then sign in and close Slack. Do not pass a normal profile such as `~/Library/Application Support/Slack` or `~/Library/Application Support/Slick` to the benchmark.

On macOS:

```bash
/Applications/Slack.app/Contents/MacOS/Slack \
  --user-data-dir="$PWD/work/perf-fixture"
```

On Windows (PowerShell), using whichever Slack build is installed:

```powershell
# Standalone (Squirrel) install
$slack = (Get-ChildItem "$env:LOCALAPPDATA\slack" -Directory -Filter 'app-*' |
  Sort-Object Name -Descending | Select-Object -First 1).FullName
& "$slack\slack.exe" --user-data-dir="$PWD\work\perf-fixture"
```

Microsoft Store (MSIX) Slack cannot be launched this way; benchmark against a standalone install, and record MSIX results separately as advisory.

On Linux:

```bash
/usr/bin/slack --user-data-dir="$PWD/work/perf-fixture"
```

Keep the fixture outside version control; `work/` is ignored.

## Boot bench

The boot bench times Slick's main-process startup work — the plugin catalog, plugin loading, theme parsing, the settings UI module, and the diagnostics recorder — in plain Node. It needs no Slack install, no Electron runtime, and no signed-in account, so it is the right loop while iterating on a change:

```bash
npm run perf:bootbench
```

Capture a baseline before a change and compare after:

```bash
npm run perf:bootbench -- --output work/perf-bootbench-baseline.json
# ...make the change...
npm run perf:bootbench -- --compare work/perf-bootbench-baseline.json
```

Each phase reports p50/p95 over `--iterations` runs (default 15, after `--warmup` unmeasured runs), and every iteration starts from a cold `require` cache so first-read cost is counted. The report also lists the slowest per-plugin requires, which is how to spot a plugin that got expensive to load.

Two diagnostics phases are reported separately and mean different things. _First write_ includes the deferred load of the previously stored sessions and happens once per launch; _steady state_ is what the recurring write timer actually costs and is the number that matters.

Because it measures a warm filesystem, the boot bench understates cold-start cost on Windows, where these reads also pass through Defender. Treat it as a relative measure, not an absolute one.

## Run benchmarks

One defaults run:

```bash
npm run perf:benchmark -- run \
  --profile "$PWD/work/perf-fixture" \
  --variant defaults
```

The complete isolation matrix randomizes stock/core/default/plugin run order. It performs 10 cold and 20 warm runs for stock, core, and defaults, plus 5 warm runs for every plugin:

```bash
npm run perf:benchmark -- matrix \
  --profile "$PWD/work/perf-fixture" \
  --output "$PWD/work/perf-results.json"
```

Useful variants are `stock`, `core`, `defaults`, `plugin:MessageLogger`, and `plugins:LastSeen,MessageLogger`. Override executable discovery with `--stock-executable` or `--slick-executable`.

Cold runs remove only cache directories inside the disposable clone. Warm runs start from an identical clone of the fixture. Every run performs read-only channel switching, scrolling, and profile-opening actions; it never sends a message.

### What the CPU and memory numbers mean

The benchmark samples the whole launched process tree. `cpuPercent` is percent of a single core, summed across the tree, and derived from the change in cumulative CPU time between consecutive samples — so an idle-window reading reflects that window rather than averaging in startup burn. `processCount` is the number of processes in the tree.

`privateKb` is RSS on macOS and Linux and private page count on Windows. These are not comparable across platforms, which is why the analyzer only ever compares a variant against stock **within** the same platform and architecture.

The first sample of every run is discarded, because a delta needs two readings.

On Windows the sampler drives one resident PowerShell CIM poller for the life of the run, rather than spawning a process per sample — a per-sample spawn costs enough CPU to disturb the measurement it is taking. If PowerShell is unavailable the run still completes, just without CPU or memory samples.

For background or soak investigations:

```bash
npm run perf:benchmark -- run \
  --profile "$PWD/work/perf-fixture" \
  --variant defaults \
  --runs 10 \
  --idle-seconds 900 \
  --background-seconds 900 \
  --soak-minutes 60
```

## Ablation and report triage

Repeat a suspect variant without one of Slick's Chromium switches or without hardware acceleration:

```bash
npm run perf:benchmark -- run \
  --profile "$PWD/work/perf-fixture" \
  --variant defaults \
  --disable-switch disable-background-timer-throttling \
  --disable-gpu
```

Generate a plugin isolation sequence from an affected user's diagnostic export:

```bash
npm run perf:benchmark -- bisect \
  --diagnostics ./slick-performance-export.json \
  --profile "$PWD/work/perf-fixture" \
  --runs 3
```

The bisect command tests core, progressively smaller halves, and each individual enabled plugin. Compare the resulting groups using their startup, interaction, CPU/memory, long-task, and DOM attribution results.

Re-analyze an existing result:

```bash
npm run perf:analyze -- work/perf-results.json
```

Reports are advisory for the first release cycle. The analyzer implements the documented relative-plus-absolute startup budgets, interaction ceiling, idle CPU/memory budgets, long-task budget, and crash/hang checks. After the baseline cycle, the same findings can become blocking release checks.

Pass `--enforce` to the analyzer or benchmark after the baseline cycle. Enforcement exits unsuccessfully for a budget regression or until macOS arm64, Windows x64, and Linux x64 results are present.

## Platform qualification

Calibrate the harness on macOS first, then run the accepted matrix on Windows x64 and Linux x64. Test Flatpak separately because it has a distinct sandbox and profile location. Record Windows ARM running x64 Slack as advisory because emulation is an expected confounder.

### Windows confounders

Windows results carry sources of variance the other platforms do not. Account for these before reading a regression into a Windows number:

- **Defender real-time scanning.** Slick's install lives in `%LOCALAPPDATA%\Slick` and its profile in `%APPDATA%\Slick`, both scanned by default. A freshly written install pays more than a settled one. Compare like-for-like, and note in the result whether an exclusion was configured.
- **Two Slack distributions.** Standalone (Squirrel) Slack lives under `%LOCALAPPDATA%\slack\app-<version>`; the Microsoft Store build lives in the ACL-locked `WindowsApps` directory and is found through the registry, which costs a synchronous `reg query` at every boot. The boot timeline reports this as `slack resources resolved`.
- **The native module mirror.** Under MSIX, Windows refuses to load executable code out of `WindowsApps`, so Slick copies Slack's entire `app.asar.unpacked` tree into `%APPDATA%\Slick\slick\native\<version>\` on first run. That mirror lives **outside** the disposable clone, so benchmark cold runs do not re-measure it. The boot timeline distinguishes the two cases as `native module mirror COPIED (first run)` versus `native module mirror cached`; to time a real first run, delete the mirror directory.
- **No launcher wrapper.** macOS and Linux launch through a shell script that exports `SLICK_LAUNCH_T0`, giving a `launcher -> electron start` segment. Windows shortcuts cannot carry environment variables, so that segment is reported instead as the `electron bootstrap -> wrapper entry` mark, measured from process start. `install.ps1` does set `SLICK_LAUNCH_T0` for the launch it performs at the end of an install.
- **ARM64 emulation.** x64 Slack on an ARM64 PC runs emulated. Keep those results advisory and labelled.

Every performance fix still needs:

1. A fixture or diagnostic export that reproduces the problem.
2. A paired before/after benchmark.
3. `npm run check`.
4. A rebuilt disposable BYOE app and a live workspace-ready/CDP smoke test.
