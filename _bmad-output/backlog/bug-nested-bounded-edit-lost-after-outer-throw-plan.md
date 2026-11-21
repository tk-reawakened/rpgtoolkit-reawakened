---
title: 'Restore nested surface transaction and snapshot correctness'
type: 'bugfix'
ticket: '16'
created: '2026-11-20'
status: 'built'
baseline_revision: 'd907521ec9aabd54c4a16e096c05b9071a2af1ce'
route: 'full'
route_source: 'auto'
risk: 'medium'
review: 'quick'
review_source: 'pinned'
lenses_ran: ['quick', 'quick', 'quick', 'quick']
review_loop_iteration: 0
context: []
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Five independently reproduced post-merge #2795 defects show surface transactions can lose successful child edits, retain failed-parent channels, overwrite newer alias commits, discard outer edits after nested no-ops, or serialize stale script-screen pixels.

**Approach:** Correct nested commit/rollback tracking at channel granularity, preserve newer canonical alias writes when rebasing active editors, avoid treating an empty bounded edit as a revision change, and materialize all committed surface-batch edits before a canonical state view. Add deterministic tests for the five reports and the disjoint-pixel alias control.

## Boundaries & Constraints

**Always:** Preserve committed descendants while rolling back only failed-parent writes; newer canonical values win same-pixel conflicts while independent pixels merge; snapshots include current committed script-owned surface state.

**Never:** Change public edit APIs, pixel encoding, schema or hash inclusion; add legacy-source-derived behavior; change browser/rendering policy or broaden the fix to unrelated surface edge cases.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Child survives unbounded failure | Batched `editSurface` parent throws after bounded child writes pixel 1 | Parent pixel rolls back; child pixel remains | Propagate parent error |
| Channel rollback | Bounded parent changes red; child changes green; parent throws | Only child green remains; same-channel child-to-baseline and committed descendant cases also persist | Propagate parent error |
| Nested no-op | Unbatched bounded parent writes red; nested child has empty bounds | Parent write commits | No error |
| Alias snapshot | Active parent draft overlaps alias commit, then whole-state snapshot; control uses disjoint pixels | Newer alias pixel wins; disjoint parent and alias edits both remain | No error |
| Batched reset snapshot | Script-screen reset while batch is open, snapshot before batch ends | Snapshot contains reset RGBA pixels | No error |

</frozen-after-approval>

## Code Map

- `packages/core/src/raster/surfaces.ts` — `commitPixelChangesToRollbacks`, `commitNestedRollbackChanges`, `committedPixels`, `rebaseActiveBatchEntries`, `editSurface`, `editSurfaceWithBounds`, and `materializePresentedSurfaces` own the transaction and canonicalization behavior. Preserve bounded dirty-span encoding and existing API boundaries.
- `packages/core/src/save/snapshot.ts`, `packages/core/src/save/game-save.ts`, and `packages/core/src/engine/checkpoint.ts` — whole-state boundaries already call `materializePresentedSurfaces`; fix the shared surface boundary rather than duplicating call-site policies.
- `packages/core/test/surface-batch.test.ts` — deterministic transaction tests and helpers (`live`, `assertCanonical`) support issue-named regressions. Use a real `GameState` plus `snapshot` for serialization coverage.
- `docs/spec/engine/runners.md` — script canvases are persistent and saved; presented pixels and script edits are materialized at canonical boundaries. No owner ruling or spec expansion is needed.
- `CHANGELOG.md` — the Unreleased section records shipped behavior changes; add one concise follow-up entry referencing #3278–#3282.

## Tasks & Acceptance

**Execution:**
- [x] `packages/core/src/raster/surfaces.ts` — keep child commits channel-specific, retain child commits when a newly created public edit parent throws, merge active provisional changes only where canonical state has not changed, skip empty-range revision bumps, and flush all committed pending surfaces at canonical materialization.
- [x] `packages/core/test/surface-batch.test.ts` — add deterministic issue #3278–#3282 tests, including rollback-to-baseline, descendant survival, same-pixel alias conflict, disjoint-pixel preservation, and a full-state reset snapshot.
- [x] `CHANGELOG.md` — record the verified surface correctness follow-up so the permanent fix is discoverable.

**Acceptance Criteria:**
- Given #3278's 2×1 failing unbounded parent and successful bounded child, when the batch closes, only the child pixel remains.
- Given #3279's nested same-pixel channel changes, rollback restores every parent-owned channel and retains child/descendant writes, including a child write back to the bitmap baseline.
- Given #3280's empty bounded child inside an unbatched outer edit, the outer pixel change survives.
- Given #3281's active editor and alias snapshot, the newer overlapping alias value wins and distinct-pixel edits both survive.
- Given #3282's same-size script-screen reset inside an open batch, whole-state serialization contains the live reset bytes.

## Implementation Notes


- Nested rollback bookkeeping now copies only changed RGBA channels, including commits made through a public `editSurface` child. A failed newly-created parent keeps a valid committed child in the open batch without eagerly encoding it.
- Alias rebase now compares active provisional writes against rollback-aware committed pixels from frame entry, preserving prior unmaterialized writes on disjoint alias commits while newer canonical values win overlapping pixels. Empty bounded edits return without revision bumps.
- Canonical serializers flush dirty entries from the active surface batch before serialization; frame presentation only materializes the presented cache, preserving deferred script-screen edits.

## Design Notes

Rollback snapshots are RGBA bytes, but transaction ownership is per changed channel; copying a changed 32-bit pixel can accidentally commit unrelated provisional channels. During a rebase, canonical changes override stale provisional writes only on conflicts; untouched canonical pixels still accept the active editor's independent changes.

## Verification

**Commands:**
- `node --test --test-name-pattern="issue #3278" packages/core/test/surface-batch.test.ts` — executes and passes the child-survival regression.
- `node --test --test-name-pattern="issue #3279" packages/core/test/surface-batch.test.ts` — executes and passes every named rollback/descendant regression.
- `node --test --test-name-pattern="issue #3280" packages/core/test/surface-batch.test.ts` — executes and passes the empty-range nested-edit regression.
- `node --test --test-name-pattern="issue #3281" packages/core/test/surface-batch.test.ts` — executes and passes same-pixel conflict, disjoint-pixel preservation, and a prior-batch edit across an alias snapshot.
- `node --test --test-name-pattern="issue #3282" packages/core/test/surface-batch.test.ts` — executes and passes the script-screen snapshot regression.
- `node --test --test-name-pattern="bounded eager edits keep b64 equal to a full re-encode and to a plain-buffer model" packages/core/test/surface-batch.test.ts` — verifies revision expectations for both empty and non-empty bounded operations while retaining seeded pixel/canonical checks.
- `node --test --test-name-pattern="a heavy tick of script drawing materialises one snapshot" packages/core/test/engine.test.ts` — keeps the heavy-tick materialization count at one.
- `node --test --test-name-pattern="batching stays on for a main-file game with a package catalogue and phase registrations" packages/core/test/engine.test.ts` — confirms batching stays enabled with package and phase registrations.
- `pnpm editor-ui-toolchain:check` — generated help is current and bundle scanning passes.
- Real-board performance profile: final follow-up code remains unverified; no headed Chromium session was started.
- `pnpm --filter @tk-reawakened/core run typecheck:tests` — succeeds for core sources and tests.
## Review Triage Log

| Finding | Verdict and evidence | Route |
|---------|---------------------|-------|
| Seeded eager-edit revision assertion | **medium** — the existing randomized test assumed every bounded draw advances `rev`; `SIZES` includes `0×0`, and the targeted run failed at line 218 (`actual: 1`, `expected: 2`) for empty bounds. The test now increments from the pre-edit revision only when bounds are nonempty; pixel-model and canonical checks remain, and the targeted rerun passed. | patch |
| Rebase compares active draft with stale bitmap baseline | **medium** — a concrete same-batch sequence showed the frame's red-10 committed value was compared against the stale zero bitmap baseline, dropping its active red-200 edit when an alias snapshot changed only pixel 1. The rebase now uses rollback-aware committed pixels, and the added #3281 control preserves red 200 plus the alias pixel; both #3281 cases pass. | patch |
| Frame publication flushed a live script batch | **medium** — required CI's unit shard 6 caught two engine assertions at `engine.test.ts:1581` and `:1703` (actual 2, expected 1). A focused trace showed `refreshFrame`'s script `refreshScreen` path flushed the active batch, followed by the normal end-of-batch write. The presentation path no longer flushes unrelated script edits; canonical snapshots, saves, and checkpoints now flush explicitly. Both protected engine tests and #3282 pass locally. | patch |

