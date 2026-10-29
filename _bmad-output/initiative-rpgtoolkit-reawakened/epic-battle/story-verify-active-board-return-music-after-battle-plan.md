---
title: 'Verify active-board return music after battle'
type: 'chore'
ticket: 32
created: '2026-10-29'
status: 'done'
baseline_revision: 'ef986e6c8b86614de5f6dfb8687b30e8bd846253'
route: 'oneshot'
route_source: 'auto'
risk: 'low'
review: 'quick'
review_source: 'pinned'
lenses_ran: ['quick']
review_loop_iteration: 0
context: []
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Existing return-music coverage does not distinguish the active board from the board where battle began.

**Approach:** Add a deterministic full-engine test that begins battle on A, changes the active board to B while retaining battle.boardKey A, and proves a won battle returns B's distinct music. Do not duplicate runner parity coverage or change runtime behavior.

</frozen-after-approval>

## Implementation Notes

Oneshot: a focused test-only change reuses the existing authored game and real stock battle.

The engine's normal transition hydrates an authored board B during the unresolved real stock fight. B's enter program restores battle music so its return music produces a distinct cue. The test asserts the saved battle key remains A during the outcome and after return, and checks the return event, cues, and audio state.

## Plan Change Log

- 2026-10-29 (completed): marked done after PR #756 (`b8dca9a9`, "test: verify active board music after battle") merged; issue #752 closed 2026-10-29T15:10:16Z. Acceptance is carried by the full-engine return-music test in `packages/core/test/battle-cues-engine.test.ts`.

## Review Triage Log

Quick independent review: no findings.

Director review requested an authored B and real transition instead of cloning the active board; applied and focused proof passed. An alternative beforePlay-listener approach exposed a separate audio binding TypeError and was not retained.

That audio binding TypeError is tracked as issue #758 — "fix(core/audio): media.voice bind dereferences a null ref after a canceled board music start" — and is not part of this ticket.

## Verification

Run a focused test and the required project gates, measuring their runtime; avoid repeated lengthy runs.

After rebasing onto main with #755 merged, the whole battle-cues-engine file passed (6 tests, 10.50s) and all gates were re-run: focused proof 0.75s; typecheck 1.10s; lint 4.55s; graph 1.19s; provenance 0.50s; licence 0.24s; test:strict 63.03s (2263 passed, no skips); golden 9.51s; golden:bun 20.75s.

On the original baseline, focused smoke passed in 0.81 seconds. Typecheck (1.02s), lint (4.82s), dependency graph (1.11s), provenance (0.50s) and licence (0.24s) passed. After the owner clarified that G5.4 and G7.3 permit fetching sample-game data and the fetcher was checked for sparse game-only checkout, fixtures fetched (5.06s), strict suite passed with 2262 tests and no skips (87.40s), Node golden passed (9.92s), and Bun golden plus closing passed (21.11s).
