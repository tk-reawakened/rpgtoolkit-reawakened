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
node tools/perf/profile-player.mjs --package demo --seconds 8
```

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

The cause is the state hash over `vm.defOwners`, which repeats the bundled `stock_battle` (112 KB) and `stock_menu`
(76 KB) source once per function they define (151 entries, ~14.6 MB). `stock_menu`'s source has a non-ASCII em dash,
so its copies miss the ASCII transition cache in `packages/core/src/save/hash.ts` and are UTF-8 encoded and hashed
byte by byte on every frame.
