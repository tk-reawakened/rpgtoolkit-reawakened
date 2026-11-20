---
title: 'Restore independent identity for repeated item placements'
type: 'bugfix'
ticket: '6'
created: '2026-11-19'
status: built
baseline_revision: '4340727b09c0596b68325f721e12182421780124'
route: 'full'
route_source: 'auto'
risk: 'high'
review: 'quick'
review_source: 'pinned'
lenses_ran: []
review_loop_iteration: 0
context: ['docs/guardrails.md']
---

<frozen-after-approval reason="human-owned intent — authorized by owner request to deliver issue #1324 end to end">

## Intent

**Problem:** Two board slots can reference one item file, but their saved sprite and item-thread identities can collapse to the same filename. A later save load then lets operations on one placement affect another.

**Approach:** Use a deterministic, collision-free identity per authored board slot. Migrate old saved sprites from `sourceSlot` and remap only ownership references proven by saved item-thread links; refuse ambiguous thread references before replacing live state.

## Boundaries & Constraints

**Always:** Preserve asset `source`, board-slot state, thread continuation and unrelated saves. Keep normal save/load atomic on failure. Keep changes deterministic and tests below one second individually.

**Never:** Infer placement ownership from filename or array order, rewrite arbitrary application strings, inspect legacy source, or change thread semantics outside duplicate item identity.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Fresh repeated placement | Two slots use the same item asset | Each has a distinct identity and item thread | None |
| Old duplicate identities | Saved item IDs match but `sourceSlot` differs | Restore each placement to its slot identity and remap linked item threads | None when each owner is attributable |
| Ambiguous item reference | Shared old key appears on a thread without unique owner linkage | Do not replace the live game | Report `restore.item-identity` |
| Literal-name collision | A board item filename equals a generated slot identity | Generate another deterministic free identity | None |

</frozen-after-approval>

## Code Map

- `packages/core/src/sprites/model.ts` -- maps authored slots to item sprite identities.
- `packages/core/src/sprites/runtime.ts` -- item keys and runtime thread ownership.
- `packages/core/src/engine/engine.ts` -- commits ordinary Save/Load state.
- `packages/core/src/engine/item-placement-identity.ts` -- validates and migrates old placement and linked thread identities.
- `packages/core/src/engine/recovery.ts` -- rebuilds interruption recovery sprites from slot identity.
- `packages/core/src/save/ledger.ts` -- validates item `sourceSlot` against the saved board.
- `packages/core/test/item-placement-identity.test.ts` and `packages/core/test/board-item-hydration.test.ts` -- focused identity and engine behavior coverage.
- `docs/spec/formats/save-game.md#duplicate-item-placement-identity` -- normative migration rule.

## Tasks & Acceptance

**Execution:**
- [x] `docs/spec/formats/save-game.md` -- specify slot-based migration and refusal of ambiguous ownership before changing code.
- [x] `packages/core/src/sprites/model.ts` -- avoid all literal board item names when generating slot IDs.
- [x] `packages/core/src/engine/item-placement-identity.ts` and `packages/core/src/engine/engine.ts` -- migrate saved IDs by source slot and remap only provable thread keys before load commit.
- [x] `packages/core/src/engine/recovery.ts` -- retain hydrated slot identity when restoring durable sprite values.
- [x] `packages/core/test/item-placement-identity.test.ts` -- prove independent movement/hiding, legacy slot restoration, ambiguity refusal and collision safety.
- [x] `CHANGELOG.md` -- record the user-visible compatibility fix.

**Acceptance Criteria:**
- Given two active slots naming one item, when one is moved or hidden, then the other and its item thread are unchanged.
- Given an old save with duplicate IDs and distinct source slots, when its thread ownership is linked uniquely, then each actor and its item-thread source/target restore under distinct slot IDs.
- Given a shared old key with unlinked thread use or an ambiguous nested return pair, when the save is loaded, then it is refused before live state replacement.
- Given a generated slot key that equals another literal item filename, when the board is hydrated, then every sprite ID remains unique.

## Implementation Notes
Implemented deterministic per-slot IDs, including collisions against all authored item filenames. Ordinary load now reconciles old actor IDs and uniquely linked item-thread roots/targets before state replacement; it refuses ambiguous unlinked or nested references. Recovery keeps the ID from the hydrated source slot. Regression coverage serializes/restores old duplicated IDs and checks independent instance movement/hide cleanup, linked thread migration, refusal atomicity, and literal-name collision.
## Plan Change Log


## Review Triage Log


## Design Notes

The current first placement keeps the historical asset-name identity when it is free. Additional placements use their slot number, then a deterministic numeric suffix if a literal asset name or another generated value occupies that candidate. Save migration uses the authored slot, never order, to determine the replacement ID.

## Verification

- `pnpm exec tsc -p packages/core/tsconfig.test.json` -- passed.
- `pnpm exec node --test --test-reporter=tap packages/core/test/item-placement-identity.test.ts` -- passed; all five cases individually under 7 ms.
- `pnpm exec node --test --test-reporter=tap packages/core/test/board-item-hydration.test.ts` -- passed; seven tests.
- `pnpm exec node --test --test-reporter=tap packages/core/test/save-load.test.ts` -- passed; 25 tests.
