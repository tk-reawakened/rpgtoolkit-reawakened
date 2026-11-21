---
title: 'Restore independent identity for repeated item placements'
type: 'bugfix'
ticket: '6'
created: '2026-11-19'
status: in-review
baseline_revision: '80fbd186621c3ff0e12bea7e0d0cfed7a2e1fd50'
route: 'full'
route_source: 'auto'
risk: 'high'
review: 'quick'
review_source: 'pinned'
lenses_ran: ['quick']
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

CI on PR #3251 exposed a recovery identity mismatch: prepared item programs used the saved item ID, while recovery installs the canonical authored ID. Recovery now indexes them by stable `sourceSlot`, falling back to ID for slotless items.
Snapshot validation also rejects duplicate item source-slot claims before either normal save restoration or interruption recovery can replace state.

## Plan Change Log

2026-11-20: Fixed the recovery program lookup exposed by the PR unit shard; static placements use stable source slots across canonical ID restoration.
2026-11-20: Reject duplicate saved item source slots at the restore boundary; document the contract and add a recovery-candidate regression.
2026-11-20: Rebased review baseline to current `origin/main` (`80fbd186621c3ff0e12bea7e0d0cfed7a2e1fd50`) after main advanced; the review diff now isolates issue-owned changes.
2026-11-20: Rebased prior review findings against the current tip: unique saved IDs remain stable, ambiguous typed waits refuse migration, and replacement IDs cannot collide with retained IDs. The pinned quick review at this base found no actionable gaps.
2026-11-20: Regenerated editor help after the changelog update; `pnpm editor-ui-toolchain:check` passes.




## Review Triage Log

- Quick review found that duplicate saved `sourceSlot` claims were accepted and recovery would use the last prepared program for both restored sprites. The save boundary now rejects the later claim with `restore.item-identity` and its field path; the regression uses distinct IDs, handles and program names.
- Perturbation proof on the current tip: disabling duplicate-slot validation made the focused test fail with “Missing expected exception” (63.2 ms); restoring the guard made it pass (59.7 ms).
- Prior P2: recovery discarded a unique saved ID. Verdict `false` at the current tip: recovery preserves `sprite.id` unless shared aliases require rekeying (`recovery.ts:413-432`); `successful recovery installs the saved sprites into the external runtime` asserts `items/token.itm` survives.
- Prior P2: typed movement/sprite waits could resolve through an ambiguous alias. Verdict `false` at the current tip: migration rejects shared keys in movement, sprite-movement, and sprite-stance waits before applying updates (`item-placement-identity.ts:102-112`); `ambiguous typed waits refuse legacy item identity migration` covers all three.
- Prior P2: a generated replacement could collide with a retained unique ID. Verdict `false` at the current tip: `occupiedIds` is seeded from all non-rekeyed IDs before replacements are assigned (`item-placement-identity.ts:48-60`); `replacement identities cannot collide with unique saved item IDs` verifies refusal without mutation.


## Design Notes

The current first placement keeps the historical asset-name identity when it is free. Additional placements use their slot number, then a deterministic numeric suffix if a literal asset name or another generated value occupies that candidate. Save migration uses the authored slot, never order, to determine the replacement ID.

## Verification

- `pnpm exec tsc -p packages/core/tsconfig.test.json` -- passed after the recovery map key type update.
- `pnpm exec node --test --test-reporter=tap packages/core/test/item-placement-identity.test.ts` -- passed; all five cases individually under 7 ms.
- `pnpm exec node --test --test-reporter=tap packages/core/test/board-item-hydration.test.ts` -- passed; seven tests.
- `pnpm exec node --test --test-reporter=tap packages/core/test/save-load.test.ts` -- passed; 25 tests.
- Seven recovery-resume tests in `packages/core/test/engine-boot.test.ts` -- individually filtered; all passed, each test body under 500 ms.
- Duplicate-slot recovery-candidate test -- passed (96 ms); with the guard removed it failed (69 ms) with “Missing expected exception”.
- Current focused verification on this branch: `pnpm exec tsc -p packages/core/tsconfig.test.json` passed; `item-placement-identity.test.ts` passed all 10 cases (max 5.20 ms); the filtered `engine-boot.test.ts` subset passed all 10 cases (max 300.06 ms).
- `pnpm help-content:generate && pnpm editor-ui-toolchain:check` passed after regenerating the changelog-derived help artifact.
- `resolve_issue.py '#1324' --check-stock` and `resolve_issue.py --validate-store` passed at `origin/main` 80fbd186621c3ff0e12bea7e0d0cfed7a2e1fd50.
