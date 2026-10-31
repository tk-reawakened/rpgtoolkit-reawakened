---
type: epic
tracker_id: "#582"
title: "Menu, party, inventory and saves work, including running threads"
parent: initiative-rpgtoolkit-reawakened
covers: ["CAP-5", "CAP-9", "CAP-10", "CAP-11"]
assignee: ""
risk: high
---

# Menu, party, inventory and saves work, including running threads

## Description

The default menu, inventory, equipment, shop, inn, party, gold and play-time systems follow legacy rules and can be replaced from RPGCode; save and load restore the complete game state, including running threads, the live board item list and RNG state. Epic 8 also owns an RPGCode dialogue interaction wrapper that publishes completion for the `stock_rpg` actor-event bridge.

## Outcome

Players manage a party, complete dialogue interactions that produce actor-scoped `talked` events, and save and resume anywhere; the CAP-5, CAP-9, CAP-10 and CAP-11 success checks are the signal.

## Done when

1. Scripted play exercises item use, equip, remove, drop, buy, sell, party swap, inn restoration and a battle item use through the shared inventory operation.
2. The main, equipment, abilities and inventory screens open directly, are replaceable by RPGCode, and preserve the specified menu and input behavior.
3. Save then load mid-script restores every ruled section and produces identical state hashes and later behavior under deterministic replay.
4. Saving is refused on boards that forbid it, saves use `saveBlob`/`loadBlob`/`listBlobs` keyed by `GameId`, and thread continuation follows the approved compatibility rule.
5. Epic 8's interaction wrapper queues `dialogue.completed` only after normal completion, and the `stock_rpg` bridge emits one actor-scoped `talked` with the approved detail and no event on interruption or failure.
6. Menu, inventory, party and save built-ins register with the VM; every E-80–87 and E-123 behavior has headless coverage.

## Boundaries

Core menu rules and default menu draw lists, inventory, equipment, shop, party, gold, time, save state, and the Epic 8-owned dialogue completion wrapper and `stock_rpg` `talked` bridge. Epic 4.21 owns message/modal UI; Epic 20 owns actor state, event infrastructure and the package shell. Legacy `.sav` import remains subject to the entry 1 ruling.

## References

- spec - _bmad-output/initiative-rpgtoolkit-reawakened/spec-rpgtoolkit-reawakened/spec-rpgtoolkit-reawakened.md, section Capabilities
- spine - _bmad-output/initiative-rpgtoolkit-reawakened/architecture-rpgtoolkit-reawakened/architecture-rpgtoolkit-reawakened.md, AD-7, AD-10, AD-11, AD-17, AD-23
- constraint - docs/guardrails.md, sections G1 and G3
- reference - docs/spec/engine/plugins-and-battle.md#e-80 to E-87, E-120 to E-123
- spec - docs/spec/engine/actors.md (actor-scoped `talked` event)
- spec - docs/spec/engine/rpgcode-modules-and-objects.md (EMIT-8, EMIT-13)
- handoff - Epic 4 ticket 4.21 / issue #406 (existing message/modal UI and input wait)

## Notes

- Decision: Jensen, 2026-10-22, Epic 8.1 (#583): legacy `.sav` import is deferred; Epic 8 implements the Reawakened canonical save format only. Amended 2026-10-27: compiler mismatch refuses the whole save; changed file source restarts only the affected thread, subject to callable/owner validation. Superseded 2026-10-30 by #809: the save records data shape in per-section versions and instruction positions in `schema.ir`; an older `ir` restarts the affected threads from source after the data migrations, a newer `ir` refuses whole, and recovery keeps the strict like-for-like rule. See `docs/spec/formats/save-game.md#save-compatibility-and-instruction-versions-owner-ruling`; implemented in #814 (PR #817).
- Decision: Jensen, 2026-10-29, #776: the ledger is the game-owned subset of savable state; normal save preserves VM continuation. The accepted field mapping, hash boundary and unresolved engineering proofs are in `docs/spec/formats/save-game.md#game-ledger-and-savable-continuation` and `discovery/save-ledger-776-proposal.md`. #593 owns load/continuation and #778 owns ledger/hash implementation; no implementation or ticket completion is implied.
- Decision: Jensen, 2026-10-23, Epic 8.1 (#583): party and inventory are the only additional built-in emitters; party roster events are on `party`, and `itemAdded`, `itemRemoved` and `goldChanged` are on `inventory`. Events describe successful committed mutations, occur exactly once after commit, and are absent for refused/no-op operations. Item events distinguish inventory-entry identity from item asset-definition identity; exact fields/semantics remain for entry 4. `goldChanged` detail is `{ previous, current, delta }`. See EMIT-8/13.
- Decision: Jensen, 2026-10-22, Epic 8.1 (#583): core owns party, inventory, equipment, gold and menu state; `stock_menu` owns replaceable navigation and presentation. TypeScript and RPGCode receive equivalent semantic query/action capabilities; core validates and applies actions, and menu presentation uses the core draw list rather than writing to the host window. Exact operation/data shapes are deferred to implementation tickets.
- Decision: Jensen, 2026-10-23, Epic 8.1 (#583): replacement-menu context is object-valued and read-only; menu actions are named capabilities validated/applied by core; TypeScript and RPGCode menu interfaces retain semantic parity. Exact public member/action names, arguments, results and operation semantics are required in the 8.3, 8.4 and 8.7 plans before coding; see E-80.
- Decision: owner-approved for 8.3: preserve `callplayerswap(...)` as the catalogue's existing unimplemented/no-op; swaps remain available through the party owner/menu action contract, with no new RPGCode function or signature. E-85 and EMIT-13 plus the 8.3 plan record the ruling. The 8.3 roster contract may start after this docs-only PR merges. Exact replacement-menu member/action names and shapes remain pending in the consumer story plans and must be specified before those menu integrations are implemented.
- Decision: epic set approved by the user, 2026-10-10.
- Waits on rpgcode-vm because: thread snapshot support.
- Waits on movement-triggers because: party and board state.
- Waits on battle because: battle state to save.
- Decision: envelope re-sliced against the architecture spine, 2026-10-10.
- Decision: Jensen, 2026-10-15: `docs/spec/` replaces `docs/format-spec.md` and `docs/engine-features.md` as the normative spec (ADR 0007, entry 1.13); the owner attests it is clean (extraction-log round 4).
- Evidence (R-13): docs/spec/formats/save-game.md now specifies legacy `.sav` minors 0–4 in full, including each thread's serialised program state, so the E-122 open question above is only a scope decision. docs/spec recommends restarting saved threads, because their positions index the original compiler's instruction list. docs/spec/examples/game/Saved/slot1.sav is a sample.
- Handoff (epic board-rendering inception, 2026-10-16): docs/spec's ownership map (`docs/spec/engine/rpgcode-functions.md#ownership-of-names-with-no-single-owner`) gives `reset`, `mainFile`, `win`, `gone` and `over` to epic 4, which registers them (entry 4.31) and owns boot, reset and quit; the command-effect catalogue JSON still listed them under this epic and entry 4.29 corrects it. This epic keeps `dirSav`, `Load()` and the `menu.screen` wait; boot (4.20) leaves the saved-game branch (E-02 step 9) and the no-player check to ports this epic implements (test doubles until then), and registers this epic's `party`, `inventory` and `menu` sections into 4.31's reset seam as entry 4.29 rules.
- Handoff: Jensen, 2026-10-19: this epic owns item/gold APIs and inventory events. The 2026-10-23 Epic 8.1 ruling now makes party and inventory the only additional built-in emitters; see the approved event details above.

- Decision: Jensen, 2026-10-22: expand Epic 8 to CAP-5 and CAP-9 for the Epic 8-owned dialogue completion wrapper and `stock_rpg` `talked` bridge; rehome #564 from Epic 20 into this epic to remove the dependency cycle.
- Decision: Jensen, 2026-10-22: approve the proposed queued game-level `dialogue.completed` signal with plain scalar `{ actorId, targetId: actor id or null, text }`, consumed by `stock_rpg` to emit actor-scoped `talked`; entry 1 records the contract in normative docs before implementation.
- Waits on Epic 4 because: entry 7 consumes the existing menu-related UI/input service contract in 4.21, and entry 11 uses its message/modal and input-wait commands. Epic 8 owns the interaction wrapper, not Epic 4 metadata.
