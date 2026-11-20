---
title: 'Keep animated board tiles playing after load'
type: 'bugfix'
ticket: 5
created: '2026-11-19'
status: 'built'
baseline_revision: 'd0d1bcec78a59d11ae8a0831e861328c33a0ad8c'
route: 'full'
route_source: 'auto'
risk: 'medium'
review: 'quick'
review_source: 'pinned'
lenses_ran: ['quick']
review_loop_iteration: 0
context: []
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Loading a board resolves an animated tile to one frame and leaves it frozen on that frame. The existing renderer can advance animations if supplied with the frame sequence.

**Approach:** Retain the board tile's ordered, resolved frames and select the visible frame from the existing deterministic clock. Prove the result through actual runner playback and save/load, not just an animation model assembled by a test.

## Boundaries & Constraints

**Always:** Follow the existing board and `.tan` specs, preserve empty frames and frame order, use the existing fixed-tick rate and phase, and keep board state serializable. Prepare frame dependencies at load; do not reread assets or rebuild animations per tick. Preserve static tiles and unmodified saves.

**Never:** Change native formats or terrain lowering, change the rounding policy for legacy rates, or fix unrelated tile-bitmap or editor preview diagnostics in this ticket.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|---|---|---|---|
| Synchronized playback | 5 fps three-frame `.tan`, two adjacent cells on one retained board | Both draw slots 2, 2, 3, 4, 2 at ticks 0, 11, 12, 24, 36 | No board reload between observations |
| Blank frames | Animation starts blank or has an empty middle frame | Cell draws nothing during that interval; later frames still draw | Blank is not a missing asset or a fallback to frame 0 |
| Saved continuation | Save during an animated board tick, then load | Draws at restored and following frame boundaries match uninterrupted playback | Do not reset phase |
| Later asset missing | First and later frame refer to different assets; the later asset is not cached | Request the later asset before loading finishes; draw it when its tick arrives | An unavailable asset follows existing board load diagnostics |

</frozen-after-approval>

## Code Map

- `docs/spec/formats/board.md#animated-tiles` and `docs/spec/formats/tiles.md#animated-tile-tan` — source of truth for frame order, timing and empty strings.
- `packages/core/src/world/hydrate.ts` — board LUT loop drops sequence after selecting the hydration tick's frame. Reuse resolution, asset request and tile metadata paths; leave the separate tile-bitmap loop alone.
- `packages/core/src/world/model.ts`, `packages/core/src/render/compose.ts` — existing JSON-safe `WorldAnimatedTile`, `selectedTile`, and consumers for square, isometric and promoted rendering. Account for blank frames without fallback in board draw paths; retain the ordinary static fast path.
- `packages/core/src/save/ledger.ts`, `packages/core/src/save/snapshot.ts` — verify tile animation projection and persistence, including blank frames, and preserve saved-state compatibility. Do not add a redundant clock.
- `packages/core/test/world.test.ts`, `packages/core/test/render.test.ts` — binary board hydration and draw command assertions. `packages/core/test/save-continuation.test.ts` and `packages/runner-harness/src/saveload.ts` — real engine request/reply and saved continuation patterns.
- `packages/runner-headless/src/closing.ts`, `packages/runner-harness/src/closing.ts` — existing bundled game loader and runner driving the real engine; use a tiny authored package for the runtime proof.

## Tasks & Acceptance

**Execution:**
- [x] `packages/core/test/world.test.ts` — capture a failing held-board reproduction and the blank/missing-frame cases before the change.
- [x] `packages/core/src/world/hydrate.ts`, `packages/core/src/world/model.ts`, `packages/core/src/render/compose.ts` — retain frame dependencies and animation, resolve blank frames correctly, and preserve static behavior.
- [x] `packages/core/src/save/ledger.ts` and existing save tests — support any changed animation frame representation and check restore against uninterrupted draws. Use existing save paths; change persistence code only if required.
- [x] `packages/runner-headless/test/animated-board-playback.test.ts` — boot authored bytes through the headless runner and verify real tick-driven frames. Reuse fixture authoring and host request/reply helpers where applicable.
- [x] `docs/spec/formats/board.md` — retain legacy facts; record Reawakened's tick behavior if needed for the changed behavior, and describe any deliberate golden changes in the PR. If changing the compose hot path, record before/after player performance and work per tick in `tools/perf/README.md`.

**Acceptance Criteria:**
- Given the authored game package, when the real runner advances across frame boundaries on one board, then the visible tiles animate in sync without board reload.
- Given the regression cases in the matrix, when the focused suite runs, then each is proven, including save/load and later asset requests. If current main already passes the complete reproduction, record evidence instead of changing runtime code.

## Implementation Notes

## Plan Change Log

## Review Triage Log

Quick review: no findings (0 high, 0 medium, 0 low, 0 false, 0 maybe-false). Nothing deferred.

## Verification

- `pnpm exec tsc -b packages/core packages/runner-headless` and `pnpm --filter @tk-reawakened/runner-headless typecheck:tests` passed.
- `node --test packages/core/test/world.test.ts packages/core/test/render.test.ts packages/runner-headless/test/animated-board-playback.test.ts` passed 12/12 (465 ms); the runner proof checks synchronized boundary draws, later-asset requests, and actual `saveBlob`/`loadBlob` continuation at the restored tick and following boundaries.
- `pnpm golden` passed: 20 vector rows/24 ticks; batch 1/3/S and 24 comparisons; 27 program snapshot/restore cases; scene and audio goldens exact.
- The same `pnpm perf:player` command on Darwin arm64, Node 26.13.0, default GPU and identical demo package SHA was run on clean baseline `d0d1bcec78a59d11ae8a0831e861328c33a0ad8c` and implementation; results are recorded in `tools/perf/README.md`.
- Re-ran the authored runner proof against the clean baseline build in a temporary checkout: both tests failed as expected (blank tick 12 drew the first tile, and the later frame asset was never requested); the temporary checkout was removed.
