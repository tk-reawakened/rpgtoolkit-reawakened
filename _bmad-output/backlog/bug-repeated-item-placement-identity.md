---
id: 6
type: bug
title: "Repeated placements of one item share sprite and thread identity"
parent: none
covers: []
after: []
tracker_id: "#1324"
remote: "https://github.com/tk-reawakened/rpgtoolkit-reawakened/issues/1324"
refined: true
hitl: false
risk: high
severity: P2
---

# Repeated placements of one item share sprite and thread identity

## Description

Placements of the same item must act as independent board instances. Older saved games can restore them with duplicate identities, causing changes to one instance to affect another.

## Reproduction

1. Create a board with two slots naming the same item file and save while both are active.
2. Load an older save whose two item sprites have the same filename identity but retain distinct source slots.
3. Observe that both restored sprites retain the same identity. Moving or removing one can affect the other or its thread.
4. Each placement and its owned thread should remain independent after loading.

## Cause Hypothesis

The ordinary load path retains duplicate saved sprite identities and does not consistently distinguish placement ownership.

## Acceptance Criteria

1. **The expected behavior holds**
   **Given** two active board slots reference one item file
   **When** either placement moves, is activated, hidden, or removed
   **Then** the other placement and its item-owned thread remain independent.
2. **Older saves restore attributable ownership without guessing**
   **Given** a save with duplicate historical item identities and distinct source slots
   **When** it is loaded
   **Then** placement sprites and item threads linked by saved thread ID are rebound to their authored slots. A shared old item key with no unique owner thread refuses the load before live state changes; unlinked application strings are left unchanged.
3. **Tests cover the conditions found and fixed**
   **Given** deterministic core regressions
   **When** each affected test runs individually
   **Then** individually run deterministic regressions cover independent instances, legacy source-slot restore, ambiguous thread ownership refusal, and literal-name collisions; each completes in under one second.
4. **Or: no change is needed, with proof**
   **Given** the reproduction
   **When** it runs on current code
   **Then** the expected behavior already holds or the report was mistaken, with evidence recorded in Notes — this supersedes 1–3.

## References

- issue — https://github.com/tk-reawakened/rpgtoolkit-reawakened/issues/1324
- related completed work — _bmad-output/initiative-rpgtoolkit-reawakened/plan-gh-1253-board-item-hydration.md
- item threads — docs/spec/engine/rpgcode-language.md#e-46
- save migration — docs/spec/formats/save-game.md#duplicate-item-placement-identity
- save continuation — docs/spec/formats/save-game.md#game-ledger-and-savable-continuation

## Verify

- `pnpm exec tsc -p packages/core/tsconfig.test.json`
- `pnpm exec node --test packages/core/test/item-placement-identity.test.ts` — each test completes in under one second.

## Notes

- Decision: Rebind only item ownership supported by saved `sourceSlot` and the placement's saved item-thread ID. Refuse a shared item key when that thread link cannot identify its owner; never rewrite arbitrary saved script strings by filename.
- Risk: Incorrect migration can alter saved continuations. Run focused ordinary-save tests in addition to acceptance tests.
