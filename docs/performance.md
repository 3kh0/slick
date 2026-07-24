# Performance testing

Slick includes two complementary performance tools:

- A lightweight runtime recorder and user-triggered diagnostic export.
- A CDP benchmark runner that compares stock Slack with Slick using disposable clones of a dedicated fixture profile.

Neither tool uploads data. The benchmark never edits the fixture profile or a normal Slack/Slick profile.

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

Equivalent Windows and Linux profiles work with the native Slack executable and `--user-data-dir`. Keep the fixture outside version control; `work/` is ignored.

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

Every performance fix still needs:

1. A fixture or diagnostic export that reproduces the problem.
2. A paired before/after benchmark.
3. `npm run check`.
4. A rebuilt disposable BYOE app and a live workspace-ready/CDP smoke test.
