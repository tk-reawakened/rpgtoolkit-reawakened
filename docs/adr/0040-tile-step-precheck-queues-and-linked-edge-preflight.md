# ADR 0040 — Tile-step precheck, blocked-step counting, queued direction intent and linked-edge preflight

* **Status:** Accepted by the owner (Jensen), 2026-11-21
* **Date:** 2026-11-21
* **Context documents:** [E-135 and the solid-step rule](../spec/engine/movement-and-collision.md#e-135), [E-138](../spec/engine/movement-and-collision.md#e-138), [R-51](../spec/engine/movement-and-collision.md#r-51), [R-53](../spec/engine/movement-and-collision.md#r-53), [Round 17 facts](../provenance/facts-round-17.md), [ADR 0033](0033-solid-obstacles-stop-active-steps.md), [ADR 0009](0009-compatibility-layer-not-the-model.md)
* **Tickets:** [#1281](https://github.com/tk-reawakened/rpgtoolkit-reawakened/issues/1281), [#1300](https://github.com/tk-reawakened/rpgtoolkit-reawakened/issues/1300), [#1290](https://github.com/tk-reawakened/rpgtoolkit-reawakened/issues/1290)

## Summary

1. A tile direction step checks its whole destination before it advances, so a destination that is already blocked never produces a partial move. A solid that becomes blocking after the step began still ends the step at the actor's last safe position (ADR 0033, unchanged). E-135's legacy rule that a later obstacle cannot interrupt a tile step is superseded.
2. A blocked player direction-style tile step is consumed and counted as a completed step; a blocked non-player direction-style step retries the same entry every update while its queue waits. R-51's diversion, wait and freeze behaviour remains for point-style steps.
3. Queued directional moves are relative intent, recomputed from the actor's last safe position when their step starts (the 3.0.x rule). Absolute point, path and waypoint targets and later script-appended commands are kept. Mixed queues keep their FIFO order, and saves preserve the entry kind so a restored direction is never expanded from a stale target.
4. A linked board-edge crossing is preflighted — bounds, layers, board vectors and the destination board's cancelable `beforeEnter` — before any movement commits. A refusal leaves the player on the source board at the last safe position with its queue kept, and produces no step-complete or party-step side effects. The linked step does not complete; the accepted crossing is a placement. This resolves the E-138 versus Round 17 ordering conflict in favour of the extracted order.

> **Amended 2026-11-22 (owner: Jensen).** Ruling 4's "queue kept" means every **later** entry is kept: the refused step's own entry is consumed, like any blocked step (R-64). An accepted crossing leaves the player facing the edge it crossed, for direction- and point-style steps. The dated text above is unchanged; see the [amendment](#amendment-owner-jensen-2026-11-22) at the end of this ADR.

## Context

[#1281](https://github.com/tk-reawakened/rpgtoolkit-reawakened/issues/1281) found that tile movement tested each 4 px advance instead of the tile destination, so a move could stop part-way through a tile when the destination was blocked. Its fix depends on two questions the specification left open: what happens to the remaining queue after a blocked step ([#1300](https://github.com/tk-reawakened/rpgtoolkit-reawakened/issues/1300)) and what a refused linked-edge arrival leaves behind ([#1290](https://github.com/tk-reawakened/rpgtoolkit-reawakened/issues/1290)).

[Round 17](../provenance/facts-round-17.md) records what the original engine did. Those facts are evidence, not rulings: the 3.1.x runtime stores queued entries as absolute targets and can send a later direction diagonally after an earlier one was dropped (certain from the arithmetic; behaviour in play probable), it clears the queue when a crossing is refused, and the linked step is never walked to completion (certain). The older 3.0.x runtime applied queued directions from the actor's actual position and kept the queue on a refused crossing (certain). Establishing the legacy behaviour does not decide which behaviour Reawakened adopts; the owner rulings below do.

Three conflicts had to be settled. E-135 said a solid that becomes blocking mid-step cannot stop the sprite, while the ADR 0033 rule already said it must. E-135 and R-51 did not say how a blocked tile direction step composes with the sprite-collision result. E-138 said a linked step completes before the board change, while Round 17 records that the crossing is attempted on the step's first update and the step is never walked to completion.

## Decision

1. **Destination precheck (R-63).** Before a direction-style tile step advances, test the collision base at the whole destination once, as E-135 describes. A blocked destination ends the step with no advance, no partial move and no successful-step event. A vector, sprite or closing door that becomes blocking after the step began ends the step at the last safe position under ADR 0033. Pixel movement keeps its per-advance sampling and sliding.
2. **Blocked step composition (R-64).** A blocked player direction-style tile step is consumed and dropped, and end-of-step processing runs for it in free roam: the party step counter gains one tile, step-triggered programs and items are tested at the intended destination, and the random-battle check runs. A non-threaded program driving the movement synchronously suppresses end-of-step processing, as it does for a completed step. A blocked non-player direction-style step retries the same entry every update and its queue waits; the blocker is unaffected. R-51 items 3 and 4 (diversion, wait, freeze) remain the rule for point-style steps.
3. **Queued direction intent (R-65).** A direction entry stores the direction and the move size, not an expanded absolute point, and its target is computed from the actor's current position when its step starts. Point-style entries keep their absolute target and are never recomputed, but keeping a target does not allow crossing solid geometry: the solid-step rule still ends such a step at the last safe position. FIFO order is preserved in a mixed queue. A save or interruption-recovery checkpoint preserves each entry's kind; a restored direction entry is recomputed from the restored position, and a restored active step is revalidated before its next advance.
4. **Linked-edge preflight (R-66).** For the selected player stepping off an edge with a board link, the arrival is preflighted before movement commits: load the destination for checking only, compute the arrival under R-53, test bounds, layer count and the board's solid vectors at the arrival spot, then run the destination board's cancelable `beforeEnter`. A failure or a cancellation is a refusal: the player stays on the source board at the last safe position (its position when the step began), its queue is kept, and no step-complete, step-triggered program or item, battle check, party step or destination-board event occurs. On success the crossing is a placement: the step does not complete, the accepted transition follows the existing E-19 and E-47 rules, and the placement's existing queue cancellation applies. A missing or unloadable destination is a refusal. Program links keep E-48's behaviour. The next step toward the edge runs the preflight again; nothing is remembered.

## Ruling 1 — destination precheck and the standing last-safe stop

**Approved ruling (owner: Jensen, 2026-11-21).** ADR 0033 stands: a newly blocking solid stops an active tile step at its last safe position. In addition, a tile direction step whose full destination is already blocked must not advance partially; the destination is prechecked before the first advance.

**Lands in.** `docs/spec/engine/movement-and-collision.md` — E-135 (bullet 4 superseded, implementation gap reworded) and R-63; this ADR.

**Evidence.** E-135's once-at-step-start test and blocked-step bullet (`docs/spec/engine/movement-and-collision.md:121-129`); ADR 0033 decision 1; Round 17 confirms that the newer runtime tests board walls only at the target position at step start (certain) and that a blocked step consumes a single update without moving (certain): `docs/provenance/facts-round-17.md:30`, `:34-35`. Round 17 also records the older runtime's per-frame check, where an idle blocker converts the step into a blocked step (probable): `docs/provenance/facts-round-17.md:88`.

**Rejected alternative.** Keep E-135's legacy rule that a later obstacle cannot interrupt tile movement. That is the defect ADR 0033 already removed, and it would let a passable-at-start destination become a partial move into a solid.

**If ruled otherwise.** Repeal R-63's precheck, restore E-135 bullet 4, and #1281 returns to its reproduction (a player at `x=60` when the destination at `x=76..84` is blocked).

## Ruling 2 — blocked player step counted, blocked non-player step retried

**Approved ruling (owner: Jensen, 2026-11-21).** A blocked player direction-style tile step is consumed and counted as a completed step; a blocked non-player direction-style step retries the same entry every update with its queue waiting. R-51's retry behaviour is kept for point-style steps. This resolves the #1300 conflict between E-135 and R-51.

**Lands in.** `docs/spec/engine/movement-and-collision.md` — E-135 amendment, R-51 item 2 cross-reference, R-64, party-steps items 1, 3 and 5; this ADR; `_bmad-output/backlog/bug-tile-movement-destination-collision.md` and `_bmad-output/backlog/spike-blocked-tile-step-queue-intent.md` records.

**Evidence.** Round 17: the player's blocked direction entry is consumed and the queue continues; the step is marked finished and, away from a synchronously driving program, treated as completed (certain) — `docs/provenance/facts-round-17.md:34-36`. Other actors retry the same entry every update and their queue waits (certain) — `:39`. The step counter and end-of-step tests run for blocked player steps, and not under a synchronously driving non-threaded program (certain) — `:78-81`. The older runtime consumed the entry and walked on the spot (certain) — `:46-48`. The blocking sprite is not affected in the direction-style case (certain) — `:60`.

**Rejected alternative.** Count nothing for a blocked step, as the party-steps rule previously said. That contradicts the documented 3.1.x step processing, and a game that places a step-triggered program at a doorway depends on pressing into it.

**If ruled otherwise.** Remove R-64's counted-step clause, restore "a blocked move adds nothing" for player steps, and drop party-steps item 5; non-player retry and R-51 may remain.

## Ruling 3 — relative queued directions, absolute points kept

**Approved ruling (owner: Jensen, 2026-11-21).** Queued directional moves after a blocked step are recomputed from the actor's last safe position, adopting the 3.0.x behaviour. Absolute path and waypoint targets and script-appended commands are kept. Mixed queues and save/restore are specified with the rule.

**Lands in.** `docs/spec/engine/movement-and-collision.md` — E-22 amendment and R-65; this ADR; `_bmad-output/backlog/spike-blocked-tile-step-queue-intent.md` record.

**Evidence.** Round 17: the newer runtime stores every entry, including direction entries, as an absolute pixel target, so a dropped direction leaves later entries aimed at points that assumed it succeeded (certain from the arithmetic; behaviour in play probable) — `docs/provenance/facts-round-17.md:24-27`. The older runtime holds relative directions and computes each target from the actor's current tile origin (certain) — `:46`. E-22 records the legacy absolute-target rule (`docs/spec/engine/movement-and-collision.md:32`). Keeping later script commands is required because the owner's rule preserves the queue rather than discarding it.

**Rejected alternative.** Keep the 3.1.x absolute-target conversion. It lets a queued east-then-north after a blocked east travel diagonally north-east, which silently crosses the wall the block was protecting.

**If ruled otherwise.** Restore E-22's absolute-direction start, delete R-65's recomputation and kind-preserving save clause, and accept that later direction entries may cross an obstacle the earlier step could not.

## Ruling 4 — linked-edge preflight; refusal keeps the queue

**Approved ruling (owner: Jensen, 2026-11-21).** Preflight the arrival — bounds, layers, board vectors and `beforeEnter` — before movement commits. If it is refused, the player stays on the source board at the last safe position and the queue is kept. This deliberately departs from legacy 3.1.x, which clears the queue. No step-complete or party-step side effects occur for a refused crossing. The linked step does not complete, resolving the E-138 versus Round 17 order conflict in favour of the extracted order.

**Lands in.** `docs/spec/engine/movement-and-collision.md` — E-28 and E-138 amendments, R-53 item 3, the Moving between boards bullets, R-66; `docs/spec/engine/actors.md` `beforeEnter` row note; this ADR; `_bmad-output/backlog/spike-linked-edge-refusal-transaction.md` and `bug-tile-movement-destination-collision.md` records.

**Evidence.** Round 17: the crossing is attempted on the step's first update, after that update's movement, and the step is never walked to completion (certain) — `docs/provenance/facts-round-17.md:99-100`; the destination is loaded for checking only (`:102`); bounds, layer count and the exact solid result are the arrival test (certain) — `:110`; end-of-step processing does not run for the crossing step (certain) — `:107`. In 3.1.x a failed arrival restores the player to the position after the first movement frame, which can be a few pixels off the grid (restore certain; off-grid probable), and clears the queue (certain) — `:132-133`. The older runtime kept the queue (certain) — `:123`; `:146` (the older blocked-edge step counted a step, which this ruling deliberately does not adopt). `beforeEnter` is cancelable and its cancellation means the step does not happen — `docs/spec/engine/actors.md:207`.

**Rejected alternative.** Complete the step, then roll back every observable effect on refusal. It commits a position outside the source board, can emit step-complete and change the party counter before the refusal is known, and requires an undo log for threads, triggers and events. Preflighting has no such intermediate state.

**If ruled otherwise.** Drop R-66's preflight, restore E-138's completing step, and specify a rollback transaction; the queue would then be cleared as in 3.1.x or kept as in 3.0.x by a further ruling.

## Day-one rules

- Land the specification change before implementation; #1281, #1300 and #1290 then implement the anchors, not their own reading of the facts.
- Never commit a position inside solid geometry: the destination precheck and the last-safe stop are the same invariant, tested from both sides.
- Keep the queue entry kind in memory, saves and interruption-recovery checkpoints. Do not serialize an expanded point for a direction entry.
- Run `beforeEnter` during preflight, before the source board's step commits. A cancelled or failed preflight leaves no board, party, event or thread effect behind.
- Do not change pixel movement, R-51's point-style diversion/wait/freeze, program links (E-48) or `send` placement under this ADR.

## Consequences

- Movement behaviour changes deterministically where a tile destination is blocked (no partial advance), where a player presses into a blocked tile (counted step), and where a linked arrival is refused (position and queue preserved). Goldens and replay gates must expect the change; no presentation-only claims are made.
- The queue becomes kind-preserving. A save written with expanded direction targets migrates by recomputing them from the saved position; an active step is revalidated before its next advance.
- R-64 makes the party counter advance on a blocked player step. A game that farms a wall for random battles will now get them; that is the documented legacy behaviour, not an accident.
- Risk: a listener's `beforeEnter` can make a crossing depend on game state. Mitigation: it runs in the preflight's deterministic phase with the same thread rules as other engine-originated cancelable emits (EMIT-11); a listener that waits for input is a catchable error.
- Risk: mixed queues can hold a point behind a wall. Mitigation: R-65 keeps the point but does not grant it passage; the solid-step stop ends the attempt at the last safe position.

## Alternatives rejected

- **Keep E-135's finish-the-tile rule.** Rejected in ruling 1: it contradicts ADR 0033 and reintroduces partial moves into solids.
- **Adopt 3.1.x's absolute queued targets.** Rejected in ruling 3: a dropped direction can redirect a later direction through the obstacle.
- **Adopt 3.1.x's queue clearing on a refused crossing.** Rejected in ruling 4: it discards player intent for a destination problem the player did not choose, and the older runtime kept it.
- **Complete then roll back the crossing.** Rejected in ruling 4: it commits observable effects before knowing whether the arrival is legal.

## Deferred

Board-edge program links (E-48) keep their current behaviour until a later ruling. Pointer repathing and path-finding across a refused edge are governed by their existing rules. No change is made to `send`, pixel sliding, R-51's point-style diversion, or the movement event vocabulary.

## Amendment (owner: Jensen, 2026-11-22)

The rulings below refine ruling 4 without rewriting its dated text. They were decided after reviewing the implemented refusal and crossing behaviour, and they match the code in `packages/core/src/sprites/movement.ts` (`finishBlockedAtStart` and the accepted-crossing branches).

1. **A refused linked crossing consumes its own queue entry; later entries are kept.** Ruling 4's "its queue is kept" means every later entry, including later script-appended commands and waypoints: the refused step's own entry is consumed, like any blocked player direction step under R-64 item 1. A refusal can therefore never repeat forever, and position, party counters, triggers, board events and movement events are otherwise unchanged (`blocked { edge }` with no `step-complete`, no `edge-exit`, no party distance and no destination effects). Recorded in `docs/spec/engine/movement-and-collision.md` — [R-66](../spec/engine/movement-and-collision.md#r-66) item 3, [R-53](../spec/engine/movement-and-collision.md#r-53) item 3, E-28 and the Moving between boards bullets — and in #1281's criteria 4 and Notes.
2. **Facing after an accepted crossing is the exit direction, for both step styles.** The player faces the edge it crossed, and placement does not reset facing. This keeps the behaviour of `origin/main` before R-66 for direction-style and point-style steps, and the rejected alternative (a placement that leaves facing unchanged unless the step had a direction) is not adopted because the crossing is still a walk off a named edge. Recorded in [R-66](../spec/engine/movement-and-collision.md#r-66) item 4 and [R-53](../spec/engine/movement-and-collision.md#r-53) item 4.

**Lands in.** `docs/spec/engine/movement-and-collision.md` (E-28, R-53 items 3–4, R-66 items 3–5, Moving between boards), this amendment, `_bmad-output/backlog/bug-tile-movement-destination-collision.md`, `_bmad-output/backlog/spike-linked-edge-refusal-transaction.md` and the movement oracle plan.

**Evidence.** The implemented refusal consumes the entry and keeps later entries (PR #3330; pinned by `packages/core/test/movement-edge-preflight.test.ts` and `packages/core/test/movement-edge-fixture-replay.test.ts`), and an accepted crossing faces the crossed edge for both step styles (pinned by the same replay over `packages/core/test/fixtures/movement/edges-board-link-program.json`).

**If ruled otherwise.** Repealing item 1 means keeping the refused entry too (one line in `finishBlockedAtStart`), and the refusal then retries on the next update; repealing item 2 means writing `active.facing ?? actor.facing` in the accepted branches.

## Amendment (owner: Jensen, 2026-11-22) — blocking-thread refusal and R-51 coverage

These decisions record two further readings after the same review. Both keep the shipped behaviour, and the dated text above is unchanged.

3. **A linked crossing is refused while a blocking thread is live.** Ruling 4's preflight runs the destination's cancelable `beforeEnter` (R-66 item 2(d)), and an engine-originated cancelable event never starts while a live `blocking`-kind thread exists (`packages/core/src/events/dispatch.ts`, diagnostic `event.dispatch-active`; EMIT-11's engine-originated dispatch rule and the [live blocking thread](../spec/engine/rpgcode-errors-and-threads.md#reawakened-live-blocking-thread)). The preflight treats any failure as a refusal, so a crossing that would otherwise be accepted is refused while any blocking script is alive — a scene program parked in `wait()` included — and the refused entry is consumed under item 1 above. Consequence for authors: a waiting blocking script blocks linked edges even onto boards with no `beforeEnter` listener. The rejected alternative accepted when the destination had no listener, or deferred the check until the thread yielded; the engine cannot know there is no listener without dispatching, and a deferred check would let a step commit before the rule it enforces runs. Recorded in [R-66](../spec/engine/movement-and-collision.md#r-66) item 2(d). Pinned by `packages/core/test/engine-edge-preflight.test.ts`, "R-66/R-68: a linked refusal under a live blocking program is refused before beforeEnter and keeps the queue".
4. **R-51's priority order needs no dedicated oracle scene.** The winner/loser total order in R-51 item 2 is pinned by the unit test `packages/core/test/movement.test.ts`, "equal-speed moving collisions use controlled-player then drawId total order", and the oracle's point and path scenes pin the diversion path. No dedicated oracle scene is to be added: this is a decision not to add one, so a future audit must not record it as a gap. The rejected alternative was a `collision-sprite-blocking` case with two equal-speed point-style actors walking at each other, whose per-tick facts would repeat the comparator the unit test already exercises. Recorded in [R-51](../spec/engine/movement-and-collision.md#r-51)'s Coverage note.

**Lands in.** `docs/spec/engine/movement-and-collision.md` (R-66 item 2(d), R-51 Coverage), this amendment and the movement oracle plan.

**If ruled otherwise.** Repealing item 3 accepts a crossing when the destination has no listener or defers the check until the blocking thread yields; repealing item 4 adds the dedicated point-style precedence case to `collision-sprite-blocking`.

