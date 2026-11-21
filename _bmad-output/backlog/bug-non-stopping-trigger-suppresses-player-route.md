---
id: 7
type: bug
title: "Non-stopping trigger suppresses later regions on an inherited player route"
parent: none
covers: []
after: []
assignee: ""
tracker_id: "#1643"
remote: "https://github.com/tk-reawakened/rpgtoolkit-reawakened/issues/1643"
refined: true
hitl: false
risk: high
severity: P2
---

# Non-stopping trigger suppresses later regions on an inherited player route

## Description

A non-stopping board program that does not move the player leaves an existing click route in place, but later regions on that route do not run. The route must resume with normal step-on checks after the program ends. Movement queued by the trigger itself must remain unable to start other triggers.

## Reproduction

1. Put the player at (48, 63) on a board with ordinary step-on regions at x=70..95 and x=120..150 on the same layer. Neither region stops movement, and both programs queue no player movement.
2. Click a destination at (200, 63).
3. Actual: the first trigger starts near tick 21 at x=80, the route resumes and reaches x=144, but the second trigger does not start near tick 45. Expected: the second trigger starts when the route enters its region.

## Cause Hypothesis

The trigger runtime stores a blanket silence flag and activates it when any player movement remains queued at trigger completion. That treats an inherited click route as though the trigger had issued it. The movement effect has a thread identity, but queued and active moves do not retain which execution issued them.

## Acceptance Criteria

1. **A non-stopping trigger preserves later step-on checks**
   **Given** a click route crossing consecutive non-stopping step-on regions whose programs queue no player movement
   **When** each program returns and the route continues
   **Then** every region starts once when the player's collision base enters it, and the existing click freeze rule still applies while a trigger blocks the game
2. **Takeover clears inherited movement once**
   **Given** a player has queued movement or a continuing waypoint
   **When** an execution applies its first accepted player-travel instruction
   **Then** the inherited queue and waypoint clear before the instruction, but the active step continues; a rejected or no-travel instruction does not take over
3. **Takeover progress follows the execution**
   **Given** a program issues travel through nested calls, waits, or later ticks
   **When** it issues another travel instruction
   **Then** that execution does not clear its earlier movement again; a separately started execution gets a fresh takeover, and later commands keep their normal append/clear behavior
4. **Only trigger-origin movement is non-recursive**
   **Given** trigger-origin and unrelated player moves share a queue or an unrelated execution appends a move
   **When** those moves enter trigger regions
   **Then** only movement issued by the active trigger execution is suppressed; unrelated and legacy-unknown movement remains eligible, and a suppressed E-40 entry re-arms on leaving
5. **Derived moves preserve provenance**
   **Given** a trigger queues a copied or linked waypoint, a path is diverted, or an active step is saved
   **When** that movement advances, completes, or is restored
   **Then** its provenance is retained through waypoint generation, diversion, and the completed-step marker
6. **Save migration is explicit and does not invent ownership**
   **Given** a current save or a pre-provenance save
   **When** it is restored
   **Then** current saves preserve per-move provenance and per-execution takeover progress; absent legacy move provenance becomes unknown and eligible, and absent legacy takeover progress becomes empty
7. **Deterministic regressions cover the contract**
   **Given** the focused movement and trigger suites
   **When** they run
   **Then** tests cover the click-route reproduction, trigger and unrelated movement, mixed/new queue entries, clear/push, rejected/no-travel commands, nested calls/waits/separate executions, active-step continuation, waypoints/diversions, E-40 rearming, save/restore mid-active, and the P-8 model, manifest, and generated fixture aligned to per-move provenance; the tests fail for both queue-wide suppression and missing trigger-origin suppression
8. **Or: no change is needed, with proof**
   **Given** the reproduction
   **When** it is run on the current implementation
   **Then** the expected behavior already holds or the report was mistaken, with evidence recorded in Notes — this supersedes criteria 1–7

## Boundaries

- Keep #1180's historical per-frame click behavior separate.
- Do not change #1281, #1290, or #1300 collision and board-transition decisions.
- Do not use queue drain as the suppression boundary; unrelated queued movement remains eligible.
- Do not infer trigger ownership for old saves. Do not change interruption recovery's deliberate discard of candidate VM continuations and queues; this ticket preserves normal save/restore only.

## References

- parent — none
- issue — https://github.com/tk-reawakened/rpgtoolkit-reawakened/issues/1643
- owner decision — docs/adr/0020-program-movement-takeover.md, Decision
- movement contract — docs/spec/engine/movement-and-collision.md, Reawakened program movement takeover
- trigger contract — docs/spec/engine/movement-and-collision.md, R-52
- click route contract — docs/spec/engine/display-input-audio.md, Reawakened click movement freeze
- movement oracle — packages/core/test/fixtures/movement/manifest.json, P-8
- interruption recovery — docs/spec/engine/interruption-recovery.md, Recovery and pause
- docs-only owner decision — https://github.com/tk-reawakened/rpgtoolkit-reawakened/pull/1680

## Notes

- Decision: the owner approved **Once on takeover** on 2026-11-07. The first accepted player-travel instruction clears inherited movement and the continuing waypoint once; later commands in that execution retain normal semantics. This is a Reawakened decision, not verified legacy parity.
- Decision: on 2026-11-19 the owner delegated the implementation choice: suppress only moves whose provenance identifies the active trigger execution. A required `triggerOrigin: boolean | null` records true for trigger-issued movement, false for other new movement, and null for old records whose origin cannot be recovered. Null is eligible for normal trigger evaluation; no historical ownership is inferred.
- Decision: takeover progress is stored per thread and targeted player. A legacy thread with no recorded takeover migrates to an empty set; it does not infer that a prior movement command took over.
- Risk: high because movement and serialized continuation change. Independent code review and the required CI gate are checks outside these acceptance criteria.
