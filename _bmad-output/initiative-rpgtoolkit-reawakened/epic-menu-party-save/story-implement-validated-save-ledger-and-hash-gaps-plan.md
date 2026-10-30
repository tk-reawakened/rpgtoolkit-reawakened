---
title: "Validated game-ledger projection and hash"
type: 'feature'
ticket: 16
status: draft
created: '2026-10-29'
risk: "high"
context:
  - "normative - docs/spec/formats/save-game.md#game-ledger-and-savable-continuation"
  - "accepted contract - discovery/save-ledger-776-proposal.md"
  - "load ownership - story-load-validation-restore-order-and-thread-continuation-plan.md"
---

## Intent

Implement the approved, versioned projection of validated game-owned progress and its domain-separated non-security hash. Keep it a derived view over one migrated, validated canonical game-state candidate; do not replace or narrow ordinary Save/Load, introduce a second mutable ledger store, or imply interruption-recovery eligibility.

## Baseline and contract

This plan is based on `origin/main` at `c076ed59b8b4361ea743a1346e47163e949dbb05` (2026-10-30), where the owner-accepted ruling is in `docs/spec/formats/save-game.md#game-ledger-and-savable-continuation` and its detailed mapping is `discovery/save-ledger-776-proposal.md`. The 3.1 baseline in those documents is historical context, not independently verified source evidence.

The contract is normative: ordinary saves retain the full VM continuation; ledger projection/hash are separate from `hashGameState`, authentication, full-save checksums, checkpoint stability and battle restart. #593 owns untrusted full-save validation, section migrations, atomic restore, hydration and compiler/source compatibility. #778 owns the ledger projection/hash and its field-specific integrity checks. Coordinate the call boundary; do not duplicate #593's restore pipeline or edit its plan/code as part of this story.

## Boundaries

- Derive only from a single, already migrated and validated `GameState` candidate. A parsed or typed object is not by itself proof of validation.
- Do not add a `GameState` section, alter canonical `.sav` bytes, change the normal save request gate, change ordinary restore, or bump existing section schema versions merely to carry a derived ledger.
- Keep existing `hashGameState` semantics for replay/tick comparisons. This hash is a distinct progress identity, not security or collision-proof equality.
- Do not implement checkpoint eligibility/promotion, paused re-entry, recovery behavior or battle handling (#777/#779/#783 scope).
- Do not silently choose between inconsistent source copies, repair derived actor equipment by replaying side effects, reset saved mutable properties from a changed asset, or omit an unproven persistent reference.

## Proposed public shape and hash

Add `packages/core/src/save/ledger.ts` with exported `GameLedgerV1`, `projectGameLedger(state)`, `hashGameLedger(ledger)`, and the version/domain constants. Re-export the API from `packages/core/src/save/index.ts`; `packages/core/src/index.ts` already re-exports that module. The projection is immutable plain data and is not inserted into `GameState` or `snapshotGameSave`.

Hash exactly the canonical tagged JSON of:

```ts
{
  domain: "tkr.game-ledger",
  version: 1,
  ledger: projection,
}
```

Use the existing `hashState`/`tagNonFinite` path from `canon/index.ts` (JCS-style sorted object keys, ordered arrays, UTF-8, FNV-1a 64-bit). Do not call `hashGameState`, add a second canonicalizer, or hash serialized save bytes. Preserve array order where below specified. Encode optional/nullable distinctions explicitly; never emit an `undefined` property. Preserve script `NaN`, `Infinity` and `-Infinity` through the existing tagged representation. Callers may compare only for the same domain/version and compatible game identity; game identity is an external comparison precondition, not a new unapproved ledger field.

## Exact v1 field mapping

| Projection path | Source mapping | Integrity and presence rule |
|---|---|---|
| `party.{members,selected,steps}` | `state.party.{members,selected,steps}` | Preserve member order, selected identity and null. Exclude `party.version` as schema metadata. |
| `actors.{nextId,actors[]}` | `state.actors.nextId`; every `state.actors.actors[]` in array order, with exactly `{id,kind,source,name,stats,statuses,progression,behaviour,customEvents}` | Include `party`, `enemy` and `npc` records, not only the party. Preserve the complete stats and progression records without guessing which fields are authored. Exclude section version and `actor.equipment` from the ledger because inventory assignments are authoritative and this actor view is derived. Validate the derived equipment references/bonuses before accepting the candidate (see dependency below). |
| `inventory.{nextId,items[],equipment[],gold}` | `state.inventory.{nextId,items,equipment,gold}` | Preserve item/equipment array order and exact `{id,source,handle,quantity}` / `{actorId,slot,itemId}` fields. Inventory item identity and equipment assignments are authoritative. Exclude `inventory.version`. |
| `script.{globals,redirects}` | `state.vm.globals`, `state.vm.redirects` | Preserve all global values and ordered redirect pairs; canonical object key sorting handles map key order. Do not include thread frames/locals just because they are roots of the full-save collector. |
| `script.persistentGraph.{objects,cells,defOwners}` | Reachable subset of `state.vm.objects`, `cells`, and `defOwners` from the proven persistent-root set | Preserve original object handles, object record order, `className`, `program`, optional `hostType`, member values and explicit `keys` enumeration order. Preserve original cell IDs and values. Include only definition owners referenced by included callable values. This mapping is conditional on the proof gates below; do not publish a “complete” projection while the root/counter proof is open. |
| `world.board` | Presence-discriminated projection of `state.world.board` | Preserve absent vs explicit `null` vs present board. For a present board include `key`, the authoritative authored raw item slots, approved durable runtime edits, and any other source-proven game-owned board mutations resolved by the mutation census below. |
| `world.board.rawItems[]` | Ordered `state.world.board.rawItems[]`; each entry is exactly `{slot,itemFile,activationPrg,multitaskPrg,initialVar,initialValue,finalVar,finalValue,loadingVar,loadingValue,activate,activationType,x,y,layer,reserved}` | Preserve all raw slots including empty holes and authored default coordinates. `world.board.items` is the compact derived view: validate it against `rawItems.filter(itemFile !== "")`; do not hash two copies of the same authored defaults. If an old candidate lacks a required raw-slot source, use a documented #593 migration or reject it—never infer a slot from a runtime sprite. |
| `world.board.runtime` | `state.world.board.runtime.{tileEdits,tileTypes}` with exact presence tags | Preserve ordered edits, edit scope, owner and nullable tile/previous data, plus ordered tile types where classified persistent. Do not assume the whole current `tileEdits` array is stable progress: `scope: "program"` records name an owner thread and `expireProgramTileEdits` removes them when that thread finishes. Reconcile this with the accepted table's unqualified inclusion of `tileEdits` before implementing the projection (open issue below). |
| `sprites.{players,items}` | `state.sprites.players/items`, ordered, using stable identity/placement fields `{id,kind,actorId,index,handle,sourceSlot,source,x,y,layer,facing,visible,controlled}` | Preserve `actorId` as absent vs null vs number; `handle`/`sourceSlot` nulls and array order exactly. Runtime `x/y/layer` are current placements, not board item defaults. Do not use `id`/filename alone as instance identity: repeated board item filenames may share `id`; validate instance correspondence by raw `sourceSlot`, `source`, compact `index`/`handle`, and `kind`. |
| `sprites.{selectedPlayer,nextItemHandle,randomEncounter}` | `state.sprites.selectedPlayer`, `nextItemHandle`, optional `randomEncounter` | Preserve the existing counter and optional/nullable encounter distinction. For encounter progress preserve `{boardKey,tile,tiles}` and validate its board relationship under the owner rule. Exclude section `version`. |
| `triggers.{boardKey,fired,repeat,suppressed,deactivated,deactivateAt}` | Exact fields from `state.triggers` | Preserve ordered lists and `deactivateAt` null; exclude `version`, `active`, `lastKeySeq`, and `silentUntilIdle` (continuation/transient). Do not infer trigger persistence across board transitions. |
| `rng.{s0,s1,s2,s3}` and `time.tick` | `state.rng` and `state.time.tick` | Preserve all four RNG words and the tick exactly. |

Projection must omit all other state from the hash, but not from ordinary saves. This includes `schema` and section versions; `vm.threads` (all kinds, frames, instruction positions, locals, operands, waits, queues and pending requests); `vm.files/effects/effectSeq/block/requestSeq/messagesOff`; `events` listener/queue/dispatch/emitter state; `menu` outside party/inventory; input/UI/camera/fx/surfaces/audio playback projection; battle and `engine.nextBattleId`; other engine phase/request/transition state; package/runtime caches, `vm.stepCounters`, compiled programs, host handles and diagnostics. Exclusion means “not ledger progress,” not “safe to drop from a normal Save/Load.” Script-visible continuation state must remain in the full snapshot and in #593 validation.

## Ownership, reachability and identity proof

Add `packages/core/src/script/ledger-reachability.ts` as a pure, non-mutating graph walker, or place the same separate pure traversal beside the existing value/cell walkers in `script/cells.ts` if that is needed to avoid duplicating reference syntax. Keep `collectCells`, `collectGarbage`, and their all-thread/event/plugin roots unchanged; they mutate live VM tables and answer a different question. Do not call GC as a projection step and do not use `eachRootValue` unchanged: it deliberately sees every object member and every thread frame.

1. Start from `vm.globals` and only explicitly enumerated roots proved to be game-owned and to survive the continuation boundary. Audit all current out-of-section/runtime roots: frame `objectHandle` and by-reference object/cell refs, thread locals/operands/wait values, event listener/queued/dispatch callables (`events`), plugin layer callables (`layerRoots`), and registered actor emitter objects. Record which roots are reconstruction from an already-ledgered owner (actor objects), continuation-only, or an actual persistent owner root. Do not treat a thread kind named `persistent` or an event/GC root as sufficient proof by itself. If a game-owned source of state is not represented by the selected roots or owner section, block completeness rather than discard it.
2. Follow a reachable `ObjectValue.handle` to exactly one object record; from that record follow every member `Value` in `keys`-defined logical enumeration order. Follow callable `captures` to cell IDs (`""` means global), callable `receiver` to object handle, values of reached cells recursively, and `object:<handle>:<member>`/cell references used by object/member and by-reference refs. Follow only the referenced declaration-owner entries. Use visited handle/cell/definition sets so rooted object cycles and self-capturing closure cycles are preserved once; exclude unreachable cycles only after proving no approved root reaches them.
3. Reject dangling/duplicate object handles, missing/malformed captured cells, unknown/mismatched callable receiver/class/program/declaration owners, invalid cell-ref targets, and invalid object-member refs before hashing. Current `snapshot.ts` accepts some handle-shaped values without checking that their target exists; rely on #593 for whole-save restore validation and add any ledger-specific post-validation checks without a parallel deserializer.
4. Preserve live object/cell identities and test allocator behavior. `vm.objects` has no independent next-handle counter; allocation derives from live handles. `vm.cellSeq` is a monotone issued-ID high-water mark and may include cells no longer reachable from the ledger roots. Prove that projecting only reachable records and setting any ledger-derived allocator state from retained IDs cannot alias an extant reference or change script-observable behavior; specifically test `cellSeq` gaps and omitted high, unreachable object handles. If that proof fails, keep the affected graph/candidate ineligible rather than silently normalizing IDs or including foreground allocation history in stable progress. Do not mutate the source `GameState` during projection.
5. Keep `vm.defOwners` in correspondence with reachable callable definitions; preserve each required program reference and let #593's compiler/source/package checks validate it. A definition or required host declaration that is unavailable or incompatible is a failed candidate, not a reason to drop the callable or substitute a new asset declaration.

Existing collectors prove normal continuation liveness, not ledger persistence. Their roots include all frames and event/plugin extras; the object collector also deliberately keeps unrooted object cycles. The new tests must prove the narrower ledger root policy independently while ensuring full snapshots retain the existing references.

## Board, sprite and mutable-source authority

Current code shows three different identities that must not be collapsed:

- `world.board.rawItems` is the authored, ordered board slot table including holes; `world.board.items` is its compact occupied-item view.
- `sprites.items[]` is the live runtime instance list. `x/y/layer` can change on movement, while the board item coordinates remain their authored defaults. Match by `sourceSlot`/`source` and the runtime instance tuple, not by filename. Duplicate source filenames can give two live instances the same `id` and must remain distinct.
- `sprites.players[]` placements are live placements and must remain separate from actor defaults and from board-item authored coordinates.

Document `rawItems` as canonical for authored slots, validate a present compact `items` view against it, and project authored defaults separately from live placements. There is no coordinate conflict when the values differ for these two different roles; reject a real identity/source/slot inconsistency, not a legitimate moved item. The full-save migration may reconstruct a compact view only from a proven raw-slot authority; it must not derive authored coordinates from moved sprites.

Before claiming v1 complete, finish a field-by-field mutation census for the `U` rows in the accepted mapping. At minimum, the present code mutates `SpriteActor.speed` and can replace actor settings; mutable `visual`/`state` fields need per-field classification. The world effect owner changes board ambient, vectors, programs/program points, tile-layer contents, and tile types; temporary program-scoped tile edits are tied to thread owner and expiry. The accepted proposal explicitly leaves these fields `U` and says a durable mutation must be retained or the candidate is unsafe. Add durable source-proven changes to the projection, with exact paths and tests, or show a deterministic reconstruction from a compatible source. Do not call them authored/static merely because they originated in a board or sprite asset.

## Equipment and candidate validation boundary

`inventory.equipment` is authoritative. The projection includes `{actorId,slot,itemId}` assignments, not `ActorRecord.equipment.{equipped,bonuses}`. Before a candidate is usable, validate that each assignment targets a live eligible actor and item, that the derived equipped references and bonus values agree with those assignments and the applicable item/character definitions, and that every referenced inventory stack exists. Never repair a mismatch by invoking the mutating equip operation during restore: actor stats already contain owner-applied deltas, so reapplying can double them.

This is a concrete integration dependency, not currently proved by a TypeScript type: the #593 builder reports that its restore work does not include asset/hook equipment reconciliation. #778 must provide a non-mutating check using the inventory/actor owners' existing derivation rules and compatible loaded asset definitions, or coordinate that owner API before calling the candidate validated. Do not duplicate the equipment formula or accept saved derived bonuses merely because their shape is valid. If current compatible definitions are unavailable, reject/defer the candidate with a located error; do not reset bonuses or stats from a changed asset.

The ledger API is called only after #593's full blob parsing, section migration, shape/reference/compiler/source checks and successful candidate hydration. The #778 projection then checks only ledger-specific structural and cross-section invariants (party actor refs, inventory/equipment refs, board/trigger/encounter identity, board-slot/sprite identity and persistent-graph closure) that are not already guaranteed by that pipeline. Agree one call seam with #593; do not make `restoreGameSave` or `applyLoadedGame` a second independent restore path.

## Coherent candidate, readback and migration

Current `snapshotGameSave` serializes the complete canonical `GameState` with the existing audio playback projection; it persists no ledger/hash. Keep those bytes and the engine save request gate unchanged. Do not compute a ledger from independent reads or attach it as a mutable save field.

For readback, the owner of a candidate/checkpoint must take the exact serialized candidate bytes, run the existing `restoreGameSave`/#593 migrations and validation plus program/package/asset hydration, then call `projectGameLedger` and `hashGameLedger` on that same validated readback. Compare to the pre-write projection/hash only when both are intended to represent the same candidate and game identity. Any optional stored projection is derived immutable data: compare it exactly to the readback projection and reject mismatch; never trust it as the authoritative state. A hash match never substitutes for full schema, reference, asset or source validation. #783 remains responsible for recovery promotion/readback eligibility; #778 supplies the deterministic projection/hash and tests the API seam, not the checkpoint flow.

No migration is needed for ordinary old saves because v1 is derived after #593 has migrated the full canonical snapshot; old `.sav` files have no ledger field. Keep the independent projection `version: 1` out of `SCHEMA_VERSIONS`. A future projection version must define explicit extraction/migration/comparison policy; reject unknown versions rather than comparing across them. If implementation proves a new persisted source field is required, that is not permission to silently add it: coordinate #593, bump the relevant section schema, migrate prior versions from a real fixture, and keep unsupported/missing progress a refusal. Do not infer a legacy 3.1 field mapping from the audit.

## Failure behavior

A candidate must be rejected before hashing/commit if any of these are found:

- invalid JSON, compiler mismatch, unsupported full-save section version, malformed/non-plain field, unsafe counter/ID, invalid tag or `undefined`/cyclic JS data;
- duplicate actor/inventory/object/cell IDs, invalid section counter invariants, party member without a live actor, equipment assignment without a valid actor/stack/slot, disagreement between authoritative assignments and derived actor references/bonuses;
- malformed board item slot table, inconsistent compact `items` view, missing board identity for current sprite/trigger/encounter data, or a sprite item whose source slot/source/instance handle cannot be matched; duplicate item *filenames* alone are valid when per-instance slots/handles distinguish them;
- unresolved callable/cell/object/member/receiver/declaration reference or a root-set proof failure;
- required changed/missing source asset, incompatible compiler/program owner or unproved mutable property whose preservation would be needed;
- a stored optional projection/hash (if introduced by a later owner) that differs from the projection/hash recomputed from the validated readback, or any projection version/domain mismatch.

Use the existing located restore diagnostics at the #593 boundary where applicable; agree any new diagnostic codes/paths with that owner instead of inventing a competing restore taxonomy. Failure must leave the currently running game/candidate unchanged under #593's atomicity rule. FNV hash mismatch is evidence of different projected data, not a security/authenticity failure.

## Implementation map

1. `packages/core/src/save/ledger.ts` — v1 types, exact projection, field-presence encoding, projection-only validation, envelope hash via `hashState`; no serializer/schema/engine changes.
2. `packages/core/src/script/ledger-reachability.ts` (or the existing shared cell-walker module if reuse avoids duplicate parsing) — pure persistent-root graph traversal, explicit root policy and object/cell/definition closure; never mutate VM tables.
3. `packages/core/src/save/index.ts` — export the ledger API and types. `packages/core/src/index.ts` already exports save APIs; avoid redundant exports.
4. `packages/core/test/save-ledger.test.ts` — table-driven projection, identity, reachability, integrity and readback tests. Use existing `node:test` conventions and fixtures; do not change other ticket plans/tests unless their owner explicitly coordinates the seam.
5. Coordinate only the agreed post-validation call point with #593 and pass the hash API to #783; do not modify #593-owned `snapshot.ts`/engine restore pipeline or #783 checkpoint code as part of #778 without explicit integration ownership. No changes to ordinary `.sav` bytes or `hashGameState`.

## Acceptance

- The projection field table and resolved decisions are implemented exactly; no silent omission is presented as a complete ledger.
- Projection is deterministic, non-mutating, plain data, preserves approved ordering/absence/tagged-number semantics, and distinguishes source-authored board-item defaults from live sprite placement.
- Rooted object/cell/callable graphs, self-cycles, cross-object cycles, receiver/object/member/cell refs and required declarations survive projection with identity intact; unreachable foreground-only locals and unrooted graphs do not alter the ledger; no live reference is lost or ID aliased.
- Cross-section identities are validated without applying mutations twice; changed/missing required assets cannot silently reset ledger values. Asset-aware equipment consistency is enforced by 8.23 before recovery eligibility, not by the ledger hash.
- Hash vectors prove the exact domain/version envelope and use existing canonical tagging/FNV-1a. Each accepted L-field mutation changes the projection/hash; changes to explicitly excluded continuation/metadata fields do not, while normal `hashGameState` behavior remains unchanged.
- A current save and supported prior-version full save derive only after #593 migration/validation; exact bytes read back to the same validated candidate give the same ledger/hash; altered ledger-bearing readback fails equality. Legacy saves need no invented ledger migration because none is persisted.
- Invalid candidates fail with precise paths and leave current state atomic; ordinary Save/Load retains threads, waits, locals, listeners and normal compiler/source compatibility.

## Required tests

Add focused `packages/core/test/save-ledger.test.ts` cases covering:

1. Exact v1 mapping, all actor kinds/fields/counters, ordered members/redirects/items/equipment/slots/edits, `version` metadata exclusions, and each excluded continuation field changing without changing the ledger hash.
2. Every ledger field changed independently changes the projection/hash; object key order canonicalizes but ordered arrays and `ObjectRecord.keys` remain significant. Pin at least one hash vector for the literal domain/version envelope and verify tagged `NaN`, `+Infinity`, `-Infinity`, explicit `null`, optional absence and no `undefined`.
3. Projection is pure (input state and full VM tables unchanged); same candidate repeated produces same projection/hash; `hashGameState` and `hashGameLedger` are distinct functions/semantics.
4. Board authored raw slots including holes and compact-view validation; a moved item keeps its original board default and different live `x/y/layer`; duplicate item filenames with distinct `sourceSlot`/`handle`/`index` remain separate; a mismatched slot/source/handle is rejected.
5. Actor/inventory party references, all actor kinds, duplicate IDs, `nextId` invariants, orphan equipment stacks/actors, derived equipped ref/bonus disagreement and missing/changed item or character definitions. Assert no equip operation runs during checking and actor stats are not double-adjusted.
6. Graph reachability from globals and each ratified persistent root; closure capture cell chains and self-capture; object/member/callable receiver chains; mutually recursive objects and rooted/unrooted cycles; callable `defOwners`; invalid dangling handle/cell/member/callable/class/owner; no mutation of `vm.objects/cells/defOwners`.
7. Transient thread locals, waits, event queue/listener and plugin-layer roots are excluded unless an explicit persistent-root rule classifies their data; test the exact classification, plus preservation of all those values in a normal full save. Cover `cellSeq` gaps and omitted high object handles to prove no alias/observable allocator change, or mark the candidate unsafe until proven.
8. Board-effect cases: durable board-scope tile edits, tile types, ambient, vectors and programs change the ledger; program-scope tile edits and transient sprite state change only the full save and not the ledger hash; changed asset defaults do not alter saved durable values.
9. `snapshotGameSave` → same bytes → `restoreGameSave`/#593 validation/migration → reproject/re-hash, with current fixtures; unsupported compiler/future schema, malformed refs and board conflicts refuse before state swap. Equipment asset consistency is verified by 8.23 before recovery eligibility; the ledger hash itself does not require asset I/O.

Run no checks as part of this planning task. The implementing/coordinating main session should select the focused test and then the package verification command once all #593/#778 integration edits have landed.

## Resolved engineering decisions (2026-10-30)

These resolve the proof gates from the accepted contract using source evidence; none invents new player-facing behavior.

1. **Persistent roots.** `vm.globals` is the only ledger root. Follow object handles, object members in `keys` order, callable captures to cells, callable receivers, and reached cell values; include `defOwners` only for reached callables. Preserve live handles and cell IDs, and include `vm.cellSeq` as the issued-ID high-water mark so no live reference can be aliased. Include `events.emitters` entries whose object handle was reached, because an actor or board host object's owner binding lives there. Do not use frames, listeners, queues, dispatch or plugin layers as ledger roots.
2. **Program-scope tile edits.** Board-scope `tileEdits` are durable board progress and enter the ledger. Program-scope edits are temporary continuation tied to a live owner; they stay in normal saves and are excluded from the ledger, so recovery shows the last durable board tile. Stable checkpoint eligibility does not need to forbid them.
3. **Board mutations.** Include `key`, `sizeX`, `sizeY`, `sizeL`, `ambient`, `vectors`, `programs`, `rawItems` and `runtime.{tileEdits(board scope),tileTypes}`. Validate the compact `items` view against `rawItems`; exclude authored layers and images because they are reconstructed from the board asset and the durable edits above capture changes.
4. **Sprite fields.** Include identity and placement (`id`, `kind`, `actorId`, `index`, `handle`, `sourceSlot`, `source`, `x`, `y`, `layer`, `facing`, `visible`, `controlled`) plus game-modified settings (`speed`, `idleTime`, `collisionBase`, `activationBase`, `visual` configuration and current selection, `multitaskProgram`). Exclude `state`, `queue`, `movement`, `prev`, `frozenUntil`, `multitaskThread` and transient frame timing from the ledger; normal saves keep them.
5. **Actors and equipment.** Project all actor records in order, including the saved equipment references and bonuses. Equipment asset reconciliation is a candidate-acceptance gate, not part of the ledger hash, and is tracked separately in 8.23 (#797). Recovery candidates are not eligible until that gate passes.
6. **Hash.** FNV-1a 64-bit over the canonical tagged `{domain:"tkr.game-ledger", version:1, ledger}` envelope. No stored mutable projection; derive from the validated candidate.

## Open proof and ruling gates

All engineering gates below are resolved by the decisions above; none is silently assumed.

1. **Persistent roots and closure identity — resolved.** Globals are the only root; the walker is pure and includes actor/board emitter bindings for reached host objects. `cellSeq` is retained; object allocation reuses freed handles safely because only reached records are omitted.
2. **Sprite `U` fields — resolved.** Durable settings enter the ledger; transient clocks, queues, movement and thread links stay continuation-only.
3. **Board effect coverage — resolved.** Durable mutable board fields are projected; authored layers and images are reconstructed.
4. **Program-scope tile edits — resolved.** Excluded from the ledger; board-scope edits are included. This follows the accepted boundary that a stable ledger must not depend on an in-flight program.
5. **Equipment derivation seam — transferred.** Ledger projection includes saved actor equipment. Asset-aware consistency is candidate-acceptance gate 8.23 (#797); recovery is ineligible until it passes.
6. **Asset-source ownership — bounded.** Durable sprite and board values are saved values, never reset from a changed asset; incompatible required assets fail candidate acceptance.

### Research updates

- Current board item records carry authored slot defaults; live sprite positions are separate mutable state. Different positions alone are not a conflict. Repeated item filenames need instance identity by slot and handle.
- The current equipment action path may invoke game hooks and change stats or emit events; never use it as a load validator. Existing saves do not record individual equipment-asset fingerprints, and v1 inventory migration does not reconstruct a nonempty actor equipment projection. A pure, asset-aware reconciliation contract and behavior-hook compatibility policy remain unproved; #593 remains open.
- `expireProgramTileEdits` discards active owners' edit records when another owner finishes; #790 tracks this defect separately. Do not claim the edit journal is sufficient for ledger recovery until its lifecycle is corrected and verified.
- Globals are a known persistent graph root, but actor wrapper bindings, runtime-registered event listeners and plugin layers require separate reconstruction proofs. Runtime garbage collection roots include frames and events and must not be reused wholesale as the ledger root set.

No additional player-facing decision is inferred. Checkpoint eligibility, listener reconstruction/handoff, paused-program recovery and battle behavior remain governed by their owning #777/#779/#783 work, not this plan or the ledger hash.
