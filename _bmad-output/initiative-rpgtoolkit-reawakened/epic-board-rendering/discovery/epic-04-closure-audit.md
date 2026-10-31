---
type: discovery
title: "Closure audit: epic 4 (board rendering), criterion by criterion"
date: 2026-10-31
baseline_revision: 3c7c71903422c3025ca592cac330e0b9b4381adf
---

# Epic 4 closure audit

Audited at **`3c7c7190`**. 35 of 36 children were already `done`; the 36th (4.36 / #790) was closed in the tracker but
its leaf file still said `tracker_status: in-progress` — corrected in this PR (see “Store” below).

| # | Done when | Verdict | Evidence |
|---|---|---|---|
| 1 | Sample-game 2D boards and the authored iso scenes render to golden PNGs compared by ledger class, with camera tracking, small-scene centering and multi-layer parallax | **Proven** | `golden/ledger.json` holds 19 rows: 13 independent-reference scenes (`S-01…`, `S-ISO-STACKED`, `S-ISO-ROTATED`, the seven `S-LIGHT-*`) and 7 `closing:*` sample-game baselines; `pnpm golden` today reports every scene “exact RGBA match (independent-reference, gating=true)” and `golden: 24 compared`; camera/centering suites exist (`camera.test.ts`, `engine-boot.test.ts`) |
| 2 | Layer order, colour-key transparency, shading + ambient arithmetic (R-15 pre-shade), animated tiles and the strict layer-then-y sprite order (R-55) | **Proven** | `render.test.ts`, `render-sprites.test.ts`, `render-iso.test.ts` (suite green in `test:strict`); the light scenes above gate the shading arithmetic pixel-exactly |
| 3 | Startup, `send`, board edit built-ins and `reset()` leave the expected state on a scripted board; focus loss pauses the tick loop; a breakpoint stops and resumes a running script mid-tick | **Proven** | `engine-boot.test.ts`, `engine.test.ts`, `input.test.ts` (focus), the breakpoint/pause paths exercised in `engine.test.ts`; board edit built-ins covered by the catalogue-driven suites |
| 4 | Message window, text, primitives and transitions are draw-list operations and replay identically in headless runs (G3 hash) | **Proven** | Scene-golden lines report “cache-flush and per-tick hashes stable” with `draw=` and `state=` hashes per scene; the text/primitive/mwin suites (`render-now.test.ts`, `render.test.ts`) drive them through the draw list |
| 5 | Rendering built-ins register with the VM and work from a program | **Proven** | The rendering pack is in the command catalogue and `catalogue:check`/`command-docs:check` are green; the built-ins run from authored programs in `render-now.test.ts` and the corpus programs |
| 6 | Persistent surfaces follow AD-27 (core-owned, `rev` on every mutation, pixels pulled by id and `rev`) and a replay with every cache flushed each frame gives identical pixels | **Proven** | `surfaces.test.ts:31` “surface read-back is revision guarded and returns owned bytes”, `:46` monotonic ids, `:94` one revision per blit; `surface-batch/hash/guard` suites; the golden's “cache-flush … stable” line is that replay |

## Findings

- **Store (fixed here):** entry 4.36 / #790 — issue CLOSED/COMPLETED, plan `status: done`, merged as `012fcdc1` plus
  the follow-up `240af5f4`, but the leaf file still carried `tracker_status: in-progress`, so the store reported the
  entry as in progress. The leaf now reads `done` and `tickets.py status` agrees. No code or plan change.
- No criterion needed a follow-up ticket.

## Not probed

No sample game has an iso board (the epic says so), so iso coverage rests entirely on the authored `S-ISO-*` scenes,
which the golden gates pixel-exactly.
