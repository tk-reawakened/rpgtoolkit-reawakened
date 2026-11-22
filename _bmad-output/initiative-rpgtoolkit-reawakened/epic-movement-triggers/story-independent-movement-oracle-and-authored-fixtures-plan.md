---
title: 'Independent movement oracle and authored fixtures'
type: 'feature'
ticket: 2
created: '2026-10-18'
status: done
baseline_revision: 'd53cdd804d5f93525c2aa4e444bc848e75f550a5'
risk: 'medium'
context:
  - 'docs/spec/engine/movement-and-collision.md'
  - '_bmad-output/initiative-rpgtoolkit-reawakened/epic-movement-triggers/discovery/movement-readiness.md'
  - '_bmad-output/initiative-rpgtoolkit-reawakened/epic-movement-triggers/discovery/inception-proposal.md'
---

## Intent
Produce the data source and observable oracle for every later movement and trigger implementation.

## Boundaries
Authored, anonymised or generated fixtures and a core-independent checker only. No legacy GPL source, no imports from `packages/core`, and no implementation behavior hidden in the fixture generator.

## Key Decisions
Use fixed-tick recorded inputs and named outcome facts, not legacy screenshot parity. Produce `movement-tile-pixel`, `collision-solid-stairs-under`, `collision-sprite-blocking`, `edges-board-link-program`, `board-entry-thread-lifecycle`, `triggers-precedence`, `actor-hydration-item-multitask`, `pathfinding-axial-diagonal-vector`, `input-replay-button-slots`, `movement-waits`, `animation-fallback-stance`, `random-encounter`, `demo-npc-pathfinding` and `demo-npc-battle-trigger`; include the reachable demo NPC/pathfinding scenario as a corpus case.

## Acceptance
Fixtures cover every named scene above. Each producer output has a stable name and expected per-tick outcome facts (positions, layers, fired triggers and events); core state/draw hashes are asserted by later consumer entries.

## Verification
Generator/check mode reproduces all committed fixtures; static import scan proves no `packages/core` dependency; later ticket references resolve to the concrete names above.

## Scope

The producer is limited to authored JSON movement scenes, a core-independent reference tick machine, deterministic generation/checking, and fixture-tool tests. It does not implement runtime movement, alter state/draw hash contracts, or copy corpus files. The fifteen scene names are the stable downstream contract:
`movement-tile-pixel`, `collision-solid-stairs-under`, `collision-sprite-blocking`,
`edges-board-link-program`, `board-entry-thread-lifecycle`, `triggers-precedence`,
`tile-step-precheck-events`, `actor-hydration-item-multitask`, `pathfinding-axial-diagonal-vector`,
`input-replay-button-slots`, `movement-waits`, `animation-fallback-stance`,
`random-encounter`, `demo-npc-pathfinding`, and `demo-npc-battle-trigger`.

## Evidence and rejected alternatives

The scene contracts use the fixed 60 Hz phases and observable rules in
`docs/spec/engine/movement-and-collision.md` E-20..E-48, R-50..R-54 and its
ratifications, plus the bounded gamepad contract in
`docs/spec/engine/display-input-audio.md#reawakened-gamepad-contract`. The
readiness audit F-19..F-22 confirms that the fetched corpus has no suitable
movement oracle, while `Prg/man_wander.prg` and `Prg/man.prg` provide the
reachable demo program/battle evidence. The producer therefore pins only those
program digests and reads them at test time.

Rejected: importing `packages/core` to generate expected facts, because that
would let a consumer pass by sharing implementation behavior. Rejected:
committing extracted demo boards/programs or claiming screenshot parity, because
G5/G7 require fetched corpus inputs and authored, docs-derived fixtures. Rejected:
state or draw hashes in this producer, because those are downstream consumer
contracts.

## Code Map

- `tools/fixtures/movement/geometry.mjs` — fixed-point geometry, collision and
  R-54 glancing calculations; pure helper reused by the simulator and tests.
- `tools/fixtures/movement/sim.mjs` — explicit fixed-tick reference world for
  actors, queues, collisions, edges, triggers, threads, encounters and path
  outcomes. It has no core or host imports.
- `tools/fixtures/movement/pathfind.mjs` — axial, diagonal and vector search,
  deterministic ties, nearest-free goals, expansion cap and cache behavior.
- `tools/fixtures/movement/input.mjs` — keyboard/gamepad/pointer replay and
  button-slot facts for E-112.
- `tools/fixtures/movement/common.mjs`, `scenes-a.mjs`, `scenes-b.mjs`,
  `scenes-c.mjs` — authored boards/actors and the fifteen named scene cases.
- `tools/fixtures/movement/index.mjs` — stable scene manifest, proposed-ruling
  registry, corpus digest checks and static workspace-import scan.
- `tools/fixtures/author/generate.mjs` — writes/checks movement fixtures beside
  existing authored format fixtures without sharing core writers.
- `packages/core/test/fixtures/movement/*.json` — committed generated data:
  one outcome row per fixed tick, with actor positions/layers, triggers and
  events; no state or draw hashes.
- `tools/fixtures/test/movement.test.mjs` — generator/check, import, corpus,
  manifest and hand-worked acceptance assertions; `package.json` registers it
  in `fixtures:test`.

## Implementation notes and proposed rulings

Every proposed choice below remains **Proposed ruling (pending owner review)**, except P-19, which is settled; the scene records the observable consequence and the rejected alternative:

- P-1/P-3/P-4: cadence begins on command, 4 px advances use 1/256 fixed-point
  vectors, and blocked/reached steps end independently. Evidence: E-22/E-23
  and R-50. Rejected frame-rate-dependent or whole-queue cancellation.
- P-2/P-17: tile reference points, deterministic A* costs/ties, nearest-free
  goal selection, vector inflation and the 1000-expansion cap are fixed as
  documented. Evidence: E-34. Rejected unordered-neighbor or floating-point
  tie behavior.
- P-5: the first stored hit edge determines the slide turn and facing is the
  step octant. Evidence: E-26/R-54. Rejected arbitrary vector iteration or
  post-hoc facing.
- P-6/P-7/P-8: activation is evaluated at completion/key press, item
  precedence and queue clearing follow E-40..E-45, and silent program movement
  suppresses nested triggers. Rejected firing every tick or marking losing
  candidates as fired.
- P-9: hidden loading-condition items own no thread until shown and stop on
  hide/remove. Evidence: E-45. Rejected starting hidden multitasks.
- P-10: encounter draws happen after activation and at most once per tile,
  with deterministic skill-pool sampling. Evidence: random-battle rule after
  E-44 and plugins-and-battle.md. Rejected per-frame rolls.
- P-11: successful edge/send transitions clear or replace the queue and use
  one-based tile/layer coordinates; refusal preserves source state. Evidence:
  E-19/E-28/R-53. Rejected immediate same-tick swaps and unaligned arrival.
- P-12/P-13/P-18: disabled diagonals use latest press, button hit tests are
  half-open, and merged gamepad/key edges do not duplicate actions. Evidence:
  E-24 and E-112 contract. Rejected duplicate queue entries and inclusive
  right/bottom hit bounds.
- P-14/P-15/P-16: animation delay rounding, waits-phase wake-up, path diversion
  and 120-tick retests are explicit. Evidence: E-21, R-51 and AD-26. Rejected
  wall-clock waits, immediate wake-up, or unbounded diversion search.
- **P-19 (settled).** A counted blocked player direction-style tile step adds one
  step's worth (32 px in tile mode) to the repeat distance of each step-activated
  repeat program whose area the attempted destination overlaps, and resets the
  others exactly as a normal step leaving the area does; pressing into a wall can
  therefore re-fire a repeat program once per press. Settled 2026-11-21 by
  [R-67](../../../docs/spec/engine/movement-and-collision.md#r-67) (owner: Jensen;
  [ADR 0041](../../../docs/adr/0041-blocked-step-repeat-distance-program-driven-steps-and-getpath.md)),
  which resolves the ambiguity in favour of the traced legacy finished-move
  processing (`docs/provenance/facts-round-18.md`, Q1a/Q1b). Rejected: the previous
  zero contribution, which contradicted that processing and made a repeat program
  in front of a wall impossible to author deliberately. Since #1281 implemented R-67
  the oracle records the settled answer: the superseded
  `blocked-counted-step-does-not-leak-into-repeat-distance` case was replaced by
  `blocked-counted-step-feeds-repeat-distance`,
  `repeat-distance-32-fires-on-every-blocked-press` and
  `blocked-press-outside-the-area-rearms-the-repeat`, and `P-19` was removed from
  the fixture registry (`tools/fixtures/movement/index.mjs` and `manifest.json`).
- **Proposed (owner note): suppressed steps and E-40 re-arming.** A step whose
  end-of-step processing is suppressed
  ([R-68](../../../docs/spec/engine/movement-and-collision.md#r-68)) is re-armed by
  nothing: the region half of E-40 re-arming is skipped with the rest of the
  bundle, so a step-on region left under a program's control keeps its `fired`
  flag, while the item half of E-40 re-arming still runs every tick. This is a
  behaviour change from pre-R-68 `main` (where a program-driven step re-armed
  regions) and follows R-68's "distances are not touched" item as written. Two
  readings: (a) current — a suppressed step is inert for regions as well as for
  its own firing, and an author expects the region to stay consumed until a
  free-roaming step re-arms it; (b) E-40 re-arming is leaving-area bookkeeping,
  not end-of-step processing, so regions should re-arm (and items should stop
  re-arming) under the same suppression predicate. Recommendation: (a) as
  implemented, because R-68 item 1 lists re-arm-adjacent distance accounting as
  suppressed and an owner can flip it with one line if they prefer (b). Pinned by
  the test "R-68: the trigger phase obeys the captured decision after a blocking
  program is already live" and the review-1 note in PR #3329.
- **Proposed (owner note): `multiRun` started by a live blocking program.** R-68
  item 2 says end-of-step processing is suppressed exactly while a live
  `blocking`-kind thread exists; item 3 says movement driven by a thread or
  `multiRun` program counts as free-roaming (including R-67 re-firing). A
  `multiRun` *started by a blocking program* satisfies both readings: item 2
  suppresses because the blocking program is alive, item 3 says it counts. The
  implementation follows item 2's exact predicate, so it is suppressed. Readings:
  (a) item 2 controls — the suppression predicate is about who owns the thread
  scheduler, not about which command queued the step, so any movement while a
  blocking program is live is suppressed; (b) item 3 controls — `multiRun` is
  named as free-roaming regardless of the caller, so its steps should count even
  inside a blocking program. Recommendation: (a) as implemented, because item 2's
  "exactly while" gives one deterministic test the whole engine can share (and
  the engine now captures that one decision per tick); (b) would need `multiRun`
  to carry a provenance bit that survives to the battle test. Pinned by "R-68:
  multiRun run from a blocking program is suppressed" in
  `packages/core/test/movement-rulings.test.ts`.
- **Proposed (owner note): facing after an accepted linked crossing.** [R-53](../../../docs/spec/engine/movement-and-collision.md#r-53),
  [E-19](../../../docs/spec/engine/movement-and-collision.md#e-19) and
  [E-47](../../../docs/spec/engine/movement-and-collision.md#e-47) do not state
  which way the player faces after an accepted crossing. Current behaviour is
  the same as `origin/main` before [R-66](../../../docs/spec/engine/movement-and-collision.md#r-66):
  the player faces the crossed edge, for both direction-style and point-style
  steps (`movement.ts` writes `facing: stepEdge` on the accepted branch, the
  per-advance fallback writes `facing: exit`, and placement never resets
  facing). Readings: (a) current — a crossing leaves the player facing the edge
  it walked off, so the next held direction reads naturally and main's
  observable behaviour is preserved; (b) a crossing is a placement, so facing
  should stay unchanged unless the step itself had a direction
  (`active.facing ?? actor.facing`), which keeps a point-style crossing's old
  facing because a point has no direction. Recommendation: (a) as implemented,
  because it preserves `origin/main`'s observable behaviour and the ruling text
  supports neither reading over the other; (b) is arguably more placement-like
  and is one line apart in the accepted branches. Owner decision requested —
  recorded as **Proposed (owner note)**. Pinned by
  `packages/core/test/movement-edge-fixture-replay.test.ts`, which replays every
  case of `packages/core/test/fixtures/movement/edges-board-link-program.json`
  including the per-tick `facing` column (the point-style crossing
  `point-path-edge-preflight-ignores-source-solid` records `E` at t0); the
  alternatives were recorded in PR #3330's body and are unchanged by this
  follow-up.
- **Proposed (owner note): a board-edge crossing is refused while a blocking
  thread is live.** R-66 item 2(d) runs the destination board's cancelable
  `beforeEnter`, and an engine-originated cancelable event refuses to start
  while another blocking thread exists
  (`packages/core/src/events/dispatch.ts`, `runEngineCancelableEventOutcome`,
  diagnostic `event.dispatch-active`). The preflight treats any failure as a
  refusal (`packages/core/src/engine/engine.ts`, `preflightBoardEdge`), so a
  crossing that would otherwise be accepted is refused while any blocking
  script is alive — a scene program parked in `wait()`, for example. R-66 item
  2(d) covers only a listener that cancels, and ADR 0040 only says a listener
  that waits for input is a catchable error; neither states that the event
  cannot start at all. Readings: (a) current — refusal is the deterministic
  choice, matching EMIT-11's rule that an engine-originated cancelable emit
  never starts while a blocking thread is live, and the player stays put;
  (b) the preflight should still accept when the destination's `beforeEnter`
  has no listeners, or defer the check until the thread yields, because a
  blocking scene program is unrelated to a destination board with no listener.
  Recommendation: (a) as implemented, because the engine cannot know there is no
  listener without dispatching, and a deferred check would let a step commit
  before the rule it is supposed to enforce runs. Consequence for authors: while
  a blocking board program is live, a linked edge is blocked and its refused
  entry is consumed (see the next note). Pinned by
  `packages/core/test/engine-edge-preflight.test.ts`, "R-66/R-68: a linked
  refusal under a live blocking program is refused before beforeEnter and keeps
  the queue": `beforeEnter` is not observed, exactly one
  `event.dispatch-active` diagnostic is recorded, the player stays at the
  source position, the refused entry is consumed and the unrelated `N` entry
  stays queued.
- **Proposed (owner note): R-51 priority-order oracle coverage.** PR #3311's
  "Ruling ambiguities" item 5 records that the direction-style scenes that used
  to exercise [R-51](../../../docs/spec/engine/movement-and-collision.md#r-51)'s
  winner/loser total order now test R-64 instead, so the total order is covered
  only by a unit test (a `keyboard`-source direct point step,
  `packages/core/test/movement.test.ts`, "equal-speed moving collisions use
  controlled-player then drawId total order"), and the oracle's point and path
  scenes divert around a blocking sprite before a collision can occur. Readings:
  (a) unit coverage is sufficient, because the total order is one comparator
  and the oracle already pins the diversion path; (b) a dedicated point-style
  precedence scene should pin the total order as observable per-tick facts, as
  every other movement and trigger rule is pinned, so a future comparator change
  fails in the oracle too. Recommendation: (b) — add one dedicated
  point-style precedence case to the `collision-sprite-blocking` scene where
  two equal-speed point-style actors walk directly at each other and diversion
  cannot help, with expected facts for the winner blocked for that tick and the
  loser frozen for the R-51 duration. No oracle test pins this yet; the existing
  guard is the unit test named above.
- **Proposed (owner note): a refused linked crossing's own queue entry is
  consumed — spec/code discrepancy, owner question open.** Current behaviour:
  a refused crossing consumes its own queue entry and keeps every later entry
  and waypoint (`finishBlockedAtStart` slices the first entry; PR #3330's
  ambiguity 1). The ruling text says the queue is "kept unchanged":
  [R-66](../../../docs/spec/engine/movement-and-collision.md#r-66) item 3
  (`movement-and-collision.md` ~417, "its movement queue is **kept unchanged**,
  including later script-appended commands and waypoints"), ADR 0040 ruling 4
  ("its queue is kept"), and ticket 8
  (`_bmad-output/backlog/bug-tile-movement-destination-collision.md`,
  criterion 4 "its queue is unchanged" and the Notes line "with the queue kept
  on refusal"). Two resolutions, and this follow-up deliberately changes
  neither because the director is asking the owner: (1) change
  `finishBlockedAtStart`'s refused branch to keep the refused entry too, so the
  next update retries the same entry and R-66 item 3's "The next step toward the
  edge runs the whole preflight again" is that retry; (2) amend R-66 item 3,
  ADR 0040 ruling 4 and ticket 8's wording to "later entries and waypoints are
  kept; the refused step's own entry is consumed because the step ended", which
  is what the code does. Both readings keep later entries, so the only
  observable difference is whether the player retries the refused crossing on
  the next update or waits for fresh input. Recommendation: (2) as implemented,
  because R-64 item 1 already consumes a blocked player direction step, R-66
  item 3 predates that composition, and keeping the entry would let a held key
  pile duplicate entries unless the retry also skipped fresh input. Pinned
  today by `packages/core/test/movement-edge-preflight.test.ts`, "R-66: a
  refused crossing ends the step blocked, uncounted, and keeps the rest of the
  queue" (and its suppression twin), plus the engine replay
  `packages/core/test/movement-edge-fixture-replay.test.ts`; whichever
  resolution the owner picks, those tests must change with it.

## Acceptance mapping

1. `movementFixtureFiles()` and `fixtures:author --check` reproduce all fifteen
   committed scene files and `manifest.json` byte-for-byte.
2. `checkMovementImports()` statically rejects core/workspace imports in every
   movement module and the author generator.
3. Every recorded-input case has one ordered expected fact row per tick with
   positions/layers and named trigger/event facts; no state or draw hashes are
   present.
4. `checkMovementCorpus()` validates the fetched demo program digests and
   required operation strings without committing corpus files.
5. The fixture test suite asserts all named scenes and the specified movement,
   collision, pathfinding, trigger, input, wait, animation, encounter and demo
   outcomes.

## Status

Done: ticket 2 is merged, and its frontmatter status is `done`. After the
initial build the oracle scenes were extended by #3329 (the R-67/R-68 cases,
including the replacement of the superseded
`blocked-counted-step-does-not-leak-into-repeat-distance` case) and by #3330
(the R-66 edge scenes and the engine replay
`packages/core/test/movement-edge-fixture-replay.test.ts`). The four owner notes
added on 2026-11-21 stay **Proposed (owner note)** until the owner rules; none of
them changes behaviour in this ticket.

## Plan Change Log

- 2026-10-18: resumed the partial implementation, completed the plan's code map
  and acceptance mapping, and recorded all pending proposed-ruling choices.
- 2026-11-21: recorded four proposed owner notes from the acceptance audit at
  `5035734d7` (facing after an accepted crossing; a crossing refused while a
  blocking thread is live; R-51 priority-order oracle coverage; and the refused
  crossing's own queue entry against R-66 item 3), refreshed the stale status
  line after #3329/#3330, and corrected ticket 8's "closed by" wording.
