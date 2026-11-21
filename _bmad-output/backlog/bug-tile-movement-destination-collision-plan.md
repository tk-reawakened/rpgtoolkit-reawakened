---
title: 'Tile movement checks each advance instead of the destination'
type: 'bugfix'
ticket: '8'
created: '2026-11-22'
status: 'blocked-owner-rulings'
baseline_revision: 'c43130719'
route: 'oneshot'
route_source: 'auto'
risk: 'medium'
review: 'thorough'
review_source: 'auto'
lenses_ran: []
review_loop_iteration: 0
context: ['docs/guardrails.md', 'docs/spec/engine/movement-and-collision.md']
---

## Intent

**Problem:** Tile-mode moves can advance in 4-pixel increments before detecting a solid destination. This branch contains a WIP experiment for testing the full destination before advancing, but the intended rule is unresolved: E-135 is explicitly superseded by the later owner ruling in ADR 0033. Do not treat this implementation or its regenerated oracle as accepted behavior.

**Always:** Keep movement deterministic and saveable; preserve R-51 sprite collision checks, winner/loser outcomes and retry behavior. **Never:** Supersede an owner ruling, choose the unresolved #1300 queue contract, or choose the #1290 linked-edge transaction.

## Blocking owner rulings

### #1281 premise — E-135 versus ADR 0033

**Evidence:** #1281 cites E-135, but `docs/spec/engine/movement-and-collision.md:132` says the Reawakened owner rule dated 2026-11-07 supersedes E-135's rule that a newly blocking obstacle cannot interrupt tile movement. Accepted ADR 0033 repeats that rule and says not to move an actor into solid geometry to complete a step. The backlog ticket's own acceptance criterion 2 also expects a newly solid obstacle to stop the active step. The issue premise may therefore be stale; neither this session nor its patch can resolve that conflict by overriding the owner ruling.

**Recommendation (pending owner review):** Retain ADR 0033: check a blocked destination before the first advance so it cannot move partially, and retain per-advance solid checks so a newly blocking obstacle stops at the last safe position. If the owner instead wants E-135's later-obstacle behavior, amend the spec and ADR explicitly before changing runtime behavior.

**Rejected alternative:** Silently apply E-135 as if it were still normative, removing the accepted stop-on-new-obstacle rule.

### #1300 — queue intent after a blocked tile step

**Evidence:** The open #1300 spike says the owner must choose whether queued direction commands are replayed from the last safe position, preserve absolute targets, or are discarded. The current WIP oracle/fixture shows why this matters: `tile-solid-blocks` starts a queued move at tick 27 from x=112 and walks through the wall spanning x=128..160 to x=156; `open-polyline-blocks-crossing` continues through the fence at x=200 to x=240. These are regenerated expectations from the modified simulator, not independent proof that this behavior is correct.

**Recommendation (pending owner review):** Recompute queued directional intent from the actor's last safe position after a blocked step, while preserving unrelated absolute path/waypoint targets and commands appended by scripts; define mixed-queue and save/restore behavior before implementing it.

**Rejected alternatives:** Preserve stale absolute targets, which the current fixture demonstrates can walk through a wall; or discard the entire queue, which can lose unrelated queued intent.

### #1290 — refused linked-edge arrival

**Evidence:** E-138/R-53 do not fully define transaction effects when a linked-edge arrival is refused. The #1290 issue notes its out-of-bounds reproduction came from unmerged #1281 work, not current main. This WIP changes the fixture simulator's queued directions on `arrival-rejected`; core linked-edge runtime behavior is unchanged.

**Recommendation (pending owner review):** Prefer preflighting the linked arrival before movement commits, with explicit `beforeEnter` timing and save/restore rules, as the latest #1290 analysis recommends. This avoids trying to undo already-observable movement, triggers, party steps and events.

**Rejected alternative:** Speculatively complete movement and then roll back only position/queue after refusal, which cannot by itself reverse those observable effects.

## Change disposition pending rulings

- A full-destination board-vector check before any advance, and a blocked-destination test proving no partial movement, remain useful under either #1281 interpretation. Under ADR 0033, keep per-advance solid checks too; under E-135, stop re-testing board vectors after acceptance. The `destinationChecked` snapshot marker and the test that a later wall does not stop the step depend specifically on the owner choosing E-135.
- Existing R-51 sprite collision behavior and its retry fixtures must remain unchanged under either board-solid ruling.
- Replaying queued directions from the actual safe position is a candidate #1300 behavior, not an approved rule. This WIP has oracle-only queue-target and refused-arrival changes; they are not a runtime implementation and cannot settle #1300 or #1290.


## Code Map

- `packages/core/src/sprites/movement.ts` — WIP one-time tile destination check; currently suppresses later board-solid checks for tile direction steps, which conflicts with ADR 0033 unless the owner amends it.
- `packages/core/src/sprites/model.ts` — snapshot-safe active-step marker used only by the E-135 experiment.
- `packages/core/test/movement.test.ts` — destination-blocking, later-obstacle, and save/restore tests; the later-obstacle expectation is pending the #1281 ruling, and review found the rewrite dropped the existing item-patrol-after-thaw assertion.
- `tools/fixtures/movement/sim.mjs` — oracle-only queue-target and refused-arrival rebase experiments; these touch unresolved #1300/#1290 contracts and must not be treated as accepted behavior.
- `tools/fixtures/test/movement.test.mjs` and `packages/core/test/fixtures/movement/collision-solid-stairs-under.json` — WIP regenerated expectations described below; oracle self-consistency does not independently validate them.

## Tasks & Acceptance

- [x] Add failing-first destination-block, later-obstacle, and save/restore movement-phase tests.
- [x] Build the E-135 behavior experiment and regenerate the movement fixture through its record path.
- [ ] Obtain owner rulings for the #1281/ADR 0033 conflict, #1300 queue intent, and #1290 linked-edge transaction; reconcile spec and plan before treating any behavior as accepted.
- [ ] Rework code, tests and oracle to follow the accepted rules; retain R-51 retry behavior and restore deleted thaw/patrol coverage.
- [ ] Run final local gates and an independent review after rulings and rework.

This branch is deliberately WIP. Its current code and fixture are not evidence that the unresolved behaviors are correct.


## Implementation Notes

- `destinationChecked` is optional active-step state set after the destination passes the board-solid test. It is snapshot-safe, but only needed if E-135 is reaffirmed.
- Regenerated `collision-solid-stairs-under.json` through the fixture author path. Three cases changed: `tile-solid-blocks` starts another queued move at tick 27 and later crosses the x=128..160 wall; `tile-movement-never-slides` blocks at tick 0 before partial diagonal movement; `open-polyline-blocks-crossing` blocks its first destination at tick 0, then the queued target crosses the x=200 fence. The first and third outcomes expose unresolved queue semantics; all changed rows require independent, hand-worked assertions before acceptance.
- The fixture simulator also rebases queued direction targets after `arrival-rejected`; this is an oracle-only #1290 choice. No linked-edge runtime behavior was changed.
- Independent review found this WIP is not ready to merge: the implementation contradicts ADR 0033 by suppressing later solid checks, the oracle regenerates the contested outcomes itself, and the test rewrite removed item-patrol-after-thaw coverage.

## Verification

- `node --test packages/core/test/movement.test.ts` — passed before the separate save/restore case was added; the save/restore case was then run individually and passed (1/1, 7 ms).
- `node --test tools/fixtures/test/movement.test.mjs` — pass (19/19, 693 ms) against the current WIP oracle and regenerated expectations; this is not independent evidence for those expectations.
- `pnpm typecheck`, `pnpm lint`, and `pnpm golden` — pass on the WIP code.
- Independent review completed; findings above identify owner-rule conflicts and verification gaps. No headed browser was used.
