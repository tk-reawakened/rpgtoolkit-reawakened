---
title: 'Verify active-board return music after battle'
type: 'chore'
ticket: 32
created: '2026-10-29'
status: 'built'
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

The test switches the active world board during the unresolved real stock fight; it asserts the saved battle key remains the original board and checks return event, cues, and audio state.

## Plan Change Log

## Review Triage Log

Quick independent review: no findings.

## Verification

Run a focused test and the required project gates, measuring their runtime; avoid repeated lengthy runs.

Focused smoke passed in 0.81 seconds. Typecheck (1.02s), lint (4.82s), dependency graph (1.11s), provenance (0.50s) and licence (0.24s) passed. After the owner clarified that G5.4 and G7.3 permit fetching sample-game data and the fetcher was checked for sparse game-only checkout, fixtures fetched (5.06s), strict suite passed with 2262 tests and no skips (87.40s), Node golden passed (9.92s), and Bun golden plus closing passed (21.11s).
