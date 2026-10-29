---
title: 'Trace a random encounter through engine battle completion'
type: 'feature'
ticket: 28
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

**Problem:** Movement-triggered encounters and stock battle completion are tested separately, leaving the real engine integration unverified.

**Approach:** Add a seeded full-engine replay test driving ordinary tile movement through the actual random encounter handoff and stock battle to a checked outcome. Compare gameplay and RNG at the same tick. Do not inject a handoff, alter encounter rules, or duplicate direct Fight and no-enemy tests.

</frozen-after-approval>

## Implementation Notes

The one-shot route is appropriate for one focused test using existing authored-game helpers. The full engine requires real simulation ticks; document measured runtime if it exceeds one second.

The authored board and main file enable a seeded chance-based encounter. A queued direction runs through the movement phase; the engine produces the handoff and the stock package reports victory. Identical runs compare tick, state hash and subsequent RNG draws. The focused test measured 1.48 seconds; running the real VM, movement and two independent replays accounts for exceeding one second.

## Plan Change Log

## Review Triage Log

- Medium, patched: the reviewer noted that string replacement could leave a direct fight in the fixture. The test now uses an explicit program without a fight command and checks the battle's initial player position after crossing the tile boundary.

## Verification

Focused test passed (1.48 seconds); complete battle-cues engine file passed (8.46 seconds). `pnpm typecheck` passed (2.81 seconds); lint, graph, provenance and licence passed together (7.10 seconds). Remaining CI gates run on the pull request.

After review, the focused test passed again (8.63 seconds test duration under concurrent typechecking); core test typecheck passed (2.58 seconds).
