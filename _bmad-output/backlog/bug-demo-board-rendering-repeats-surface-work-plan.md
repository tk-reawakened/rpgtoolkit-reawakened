---
title: 'Demo board rendering misses display rate after repeated surface work'
type: 'bugfix'
ticket: 14
created: '2026-11-19'
status: 'in-progress'
baseline_revision: '7a717c73d68e9e03ffda97d8523af12caab36f73'
route: 'oneshot'
route_source: 'pinned'
risk: 'high'
review: 'quick'
review_source: 'pinned'
lenses_ran: [quick]
review_loop_iteration: 9
context:
  - /Users/jensen/projects/rpgtoolkit-reawakened/.worktrees/issue-2795/docs/guardrails.md
  - /Users/jensen/projects/rpgtoolkit-reawakened/.worktrees/issue-2795/docs/adr/0036-performance-budgets.md
  - /Users/jensen/projects/rpgtoolkit-reawakened/.worktrees/issue-2795/docs/spec/engine/runners.md
  - /Users/jensen/projects/rpgtoolkit-reawakened/.worktrees/issue-2795/tools/perf/README.md
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** After reaching `boards/start.brd`, the live demo still falls below a 120 Hz display rate because surface encoding and raster blending dominate CPU time. Current-main measurement on the M1 Pro after #2796 reaches 94.7 fps with no long tasks, but `encodeSurfaceBytes` still accounts for 27.8% of sampled self CPU; the old 25.9 fps / 54-long-task measurement belongs to pre-#2796 commit `3e61f3c2a`.

**Approach:** Use the measured actual-board profile to reduce repeated full-surface encoding work while preserving the deterministic surface, pixel and state contracts. Add a deterministic work-count budget that proves the improvement; record comparable before/after headed Chromium profiles on the actual board. Timing is advisory and never gates CI.

</frozen-after-approval>

## Implementation Notes

`refreshFrame` skips unchanged draw-list hashes, then rasterizes a changed list. It installs the rasterizer-owned RGBA buffer as derived surface 0 without encoding; canonical snapshots, game saves, scene checkpoints, external phase and reset registrations, script observers and external-plugin state boundaries materialize pending pixels only when needed. The live runner's trusted input, movement, trigger and audio phase callbacks use the deferred path because they do not inspect screen pixels. Callbacks that can retain mutable `GameState` materialize each committed frame before the next engine callback; completed-tick observers also run after pending pixels are canonical. Script reads continue through the decoded-record cache, and revisions still advance once per presented frame. The hot path reuses its decoded record and bitmap metadata when dimensions stay stable, with constant metadata work and no per-frame pixel scan, copy or base64 encoding. Surface colour aliases are public mutable state, so release/replacement invalidates by scanning the authoritative colour table rather than relying on a derived reverse index. Regression coverage checks real engine redraws with built-in phase wiring, player registration work budgets, canonical callback and reset boundaries, retained external references, snapshot/save/checkpoint output, plugin visibility, colour-cache alias invalidation and hash neutrality. The final Apple M1 Pro / Darwin 27.2.0 arm64 / Node 26.13.0 actual-board profile measured 120.7 fps, p99 10.3 ms and zero long tasks; `encodeSurfaceBytes` was absent from sampled self CPU. Timing remains advisory; preserve canonical save/restore, script-visible screen reads, pixel/state goldens and deterministic work budgets.

## Verification

**Commands:**
- `node --test packages/core/test/presentation-surface-encoding.test.ts` -- PASS (23 tests; each body <1 ms), including shared alias conflicts, open-batch snapshots and transaction rollback cases.
- `node --test --test-name-pattern='engine-rendered changed frames|input phase callbacks observe and retain canonical pixels|package code that reads the state mid-thread sees exactly what the eager engine shows' packages/core/test/engine.test.ts` -- PASS (3 tests); the retained-state regression checks visibly changed canonical pixels in the movement callback before completed-tick observation.
- `node --test --test-name-pattern='main-file movement settings survive boot and reset' packages/core/test/engine-boot.test.ts` -- PASS (1 test); retained state from reset registrations is canonical after reset redraw.
- `node --test packages/runner-web/test/live-phase-presentation.test.ts` -- PASS (2 tests); production live-phase wiring has zero encoded bytes across ordinary frames; a single actual reset dispatch uses one 1,024-byte fresh screen and confirms built-in input reset registration behavior.
- `node --test packages/core/test/surface-batch.test.ts` -- PASS (14 tests, 510 ms); `raster-presentation.test.ts` -- PASS (8 tests); `engine-surface-read.test.ts` -- PASS (15 tests); `surface-hash.test.ts` -- PASS (19 tests); `save-load.test.ts` -- PASS (25 tests).
- `pnpm build && pnpm browser:build`, both core/runner-web test typechecks -- PASS.
- `pnpm perf:player --headed --out .perf/issue-2795-release` -- PASS on `boards/start.brd`; current main 110.2 fps, candidate 120.5 fps, p99 17.6 → 10.3 ms, zero long tasks; `encodeSurfaceBytes` absent from sampled self CPU.

## Review Triage Log

- **Preserve pending screen pixels through no-op batched edits** — Fixed. `materializePresentedSurfaces` now reconciles the screen's active batch record before checking the pending frame; regression test opens a batch, makes a no-op screen edit, changes frame dimensions, and asserts the canonical bytes/dimensions. `presentation-surface-encoding.test.ts` passes.
- **Measure one reset from dispatch through redraw** — Fixed. The test clears the reset request before posting, starts byte accounting before dispatch, verifies the built-in reset's `pointerPlane: null` behavior, and observes one fresh 32×32 screen encoding for the entire reset/redraw.
- **Keep battle notifications scoped to interactive sessions** — Fixed. The shared audio phase still updates `latest` for all sessions, but returns before battle change notifications for noninteractive closing-plan sessions.

- **Materialize shared screen batch entries through aliases** — Fixed. `materializePresentedSurfaces` resolves the active batch buffer by shared `SurfaceState` identity through `pendingEntries`, not only the current section; regression edits in one section and canonicalizes through another, checking encoded bytes and dimensions. `presentation-surface-encoding.test.ts` and `surface-batch.test.ts` pass.

- **Rebase a clean batch after a snapshot inside its edit callback** — Fixed. When materialization canonicalizes a clean active batch, the batch entry now follows the new bitmap/b64 and canonical baseline so callback edits made after the snapshot remain valid through `endSurfaceBatch`; regression snapshots mid-edit and verifies the intermediate presented frame and final edited pixels.

- **Preserve the outer edit after a nested no-op alias batch closes** — Fixed. Track active batch entries per shared `SurfaceState`; canonicalization rebases all still-open buffers onto the observed pixels, while the detached outer editor continues applying its eventual changes. The regression nests an alias batch inside the outer editor, snapshots through the alias, then checks the outer changes after batch close.

- **Keep alias batch edits across canonicalization and replacement frames** — Fixed. Commits make the current pending buffer authoritative; starting a replacement alias batch materializes any dirty authoritative buffer first. Bounded editors retain their live buffer through same-frame canonicalization, and both edit paths reject stale callback commits after a newly presented frame invalidates the batch. Three deterministic regressions cover these contracts.

- **Keep reentrant bounded edits isolated from snapshots and alias changes** — Fixed. Active callbacks no longer mark their uncommitted pixels dirty during canonicalization; rebases merge only callback changes over newly committed canonical pixels. Eager edits copy canonical pixels, and a throwing stale editor removes only its own batch entry. Regressions cover repeated snapshots then throw, committed alias pixels during an editor, replacement batch preservation, and decoded-cache isolation.
