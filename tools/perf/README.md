# Player performance profiling

Profiles the live web player — the same page the editor's Run panel loads in its iframe — while the player walks
around, and reports frame timing, tick rate, long tasks and the hottest functions. It is a developer tool, not a test.

## Setup (once per checkout)

```bash
pnpm install
pnpm build
pnpm browser:build
pnpm fixtures:fetch
node tools/make-package/run.mjs fixtures/legacy/demo --closing-plan golden/closing/plan.json --game demo --out fixtures/packages/demo.tpk --title Demo
```

If Playwright's Chromium is missing locally, install it with `pnpm exec playwright install chromium`.

## Run

```bash
pnpm perf:player
```

That is `node tools/perf/profile-player.mjs --package demo --seconds 8`; call the script directly to pass options.
These timings are advisory and never gate CI. The checks that gate are deterministic work-count budgets
(`packages/*/test/perf-budget-*.test.ts`), per [ADR 0036](../../docs/adr/0036-performance-budgets.md).

Options: `--headed` shows the browser; `--swiftshader` forces software GL (use it only where there is no GPU, such as a
cloud container, because it caps the frame rate); `--out <dir>` (default `.perf/`); `--port <n>` (default 4173); `--executable <path>` uses a specific Chromium binary.

The profile is written to `.perf/<package>.cpuprofile`; load it in Chrome DevTools (Performance panel, "Load profile").
`node tools/perf/summarize-profile.mjs <file>` prints the self/inclusive table again.

## Baseline (2026-11-15, demo, cloud container, software GL)

| Measurement | Value |
|---|---|
| Frame rate | ~15 fps (p50 frame 67 ms) |
| Ticks per second | ~62 (the simulation keeps time; frames are what drop) |
| Long tasks in 8 s | 97 (~6 s total) |
| `hashGameState` | ~71% of CPU, ~50 ms per call, once per `advance` |
| Game simulation (`runPhase`) | ~0.4 ms per frame |

The cause was the state hash over `vm.defOwners`, which repeats the bundled `stock_battle` (112 KB) and `stock_menu`
(76 KB) source once per function they define (151 entries, ~14.6 MB). `stock_menu`'s source has a non-ASCII em dash,
so its copies missed the ASCII transition cache in `packages/core/src/save/hash.ts` and were UTF-8 encoded and hashed
byte by byte on every frame. The repetition itself was fixed by #2767, which is now on main.

## Historical measurements (2026-11-15, demo, Apple-silicon Mac, real GPU, 120 Hz display, `--headed`)

These earlier runs waited for a tick count but did not verify entry into the board. The demo requires Enter at its
title screen, so these figures do **not** establish walking-gameplay performance (#2794). The tool now passes the
title screen and records the active board before sampling.

| Measurement | Before | After #2766 (non-ASCII transition cache) | After #2766 + #1890 (hash on request) |
|---|---|---|---|
| Frame rate | 8.5 fps | 111 fps | 119 fps (display cap) |
| Frame p50 / p99 | 117 ms / 354 ms | 8.3 ms / 31 ms | 8.3 ms / 16.5 ms |
| Long tasks in 8 s | 73 (9.2 s) | 2 (0.17 s) | 0 |
| Main thread idle | ~0% | 12.5% | 71% |
| Hashing self time (`process`, `utf8Encode`, `serialize`, `hashGameState`, `tagNonFinite`) | ~89% | ~42% | ~5% |

With #1890 the live player creates its engine with `stateHashInReports: "on-request"`, reads the hash only when it
posts a status to the editor or refreshes its report text (at most every 250 ms, or at once when the status changes),
and hashes lazily for `window.__live.stateHash`.

## Integration measurement (2026-11-15, actual demo board)

Apple M1 Pro, 16 GiB RAM, Node 24.21.0, headed Playwright Chromium with default GPU, eight-second requested runs.
Both runs reached `boards/start.brd` before profiling. The baseline is main `3e61f3c2a`, which already includes #2767;
the candidate integrates #1890/#2766 and the diagnostics fixes. These are single-run advisory observations.

| Measurement | Current main | Integrated branch |
|---|---:|---:|
| Frame rate | 25.9 fps | 39.0 fps |
| Frame p50 / p99 | 41.6 / 73.9 ms | 27.2 / 57.0 ms |
| Long tasks | 54 (3217 ms total) | 4 (214 ms total) |
| Ticks per second | 61.8 | 62.7 |
| Measured duration | 8.805 s | 8.674 s |

Run `node tools/perf/profile-player.mjs --package demo --seconds 8 --headed` after the setup above. The integration
removes whole-state report hashing from ordinary live advances; an explicit read still hashes the current state,
and editor status reads remain throttled to 250 ms. FNV transitions retain exact hashes and avoid repeated UTF-8
scans after a cache lane is learned. The proposed 64 KiB warm re-hash work budget is unchanged.

The game still misses display rate: `encodeSurfaceBytes` accounts for 31.4% of sampled self CPU in the candidate.
The remaining surface/rendering performance is tracked separately in #2795; this integration does not claim to fix it.
