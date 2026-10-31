---
id: 13
type: bug
title: "[5.13] Trigger regions fire across layers, and three Done-when semantics are untested"
parent: epic-movement-triggers
covers: ["CAP-2", "CAP-6"]
after: []
assignee: ""
tracker_id: "#886"
remote: "https://github.com/tk-reawakened/rpgtoolkit-reawakened/issues/886"
tracker_status: done
refined: true
hitl: false
risk: medium
severity: P2
---

# [5.13] Trigger regions fire across layers, and three Done-when semantics are untested

## Description

Epic 5 Done-when 3 requires unit tests for once-per-entry, repeat distance, key-press vs step-on,
items-before-regions precedence, layer matching and run-if/then-set. The closure audit marks it Proven on
two cases; in fact three of the six semantics had no test. Writing them exposed a defect.

**Defect.** `runTriggersPhase` collects every region from the board (`triggers/runtime.ts`, the
`board.programs.map(regionCandidate)` line) and never compares its `layer` with the player's in the
`qualifying` filter, so a region authored on layer 1 fires for a player standing at the same place on
layer 2. Items were already filtered by layer; regions were not.

**Coverage.** `packages/core/test/triggers.test.ts` held three cases and used `layer: 1` everywhere;
`activationType: 1` appeared only in format round-trip tests, and `setVar`/`setValue` only as snapshot
payload. Key-press vs step-on, layer matching and then-set were untested.

## Fix

- `packages/core/src/triggers/runtime.ts` — the qualifying filter now requires
  `candidate.layer === player.layer`, so a trigger belongs to the layer it was authored on.
- `packages/core/test/triggers.test.ts` — three cases: a key-press region and a step-on region in the same
  place, each firing only for its own activation kind; a region on another layer not firing and firing on
  the player's layer; and a completed program writing its `finalVar`/`finalValue`.

## Verification

`pnpm test:strict` (2,436 tests, 0 skipped), `pnpm golden` and `pnpm closing` (8/8) unchanged, `pnpm typecheck`,
`pnpm lint`.
