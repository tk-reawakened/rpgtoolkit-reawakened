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
refined: false
hitl: true
risk: high
severity: P2
---

# Non-stopping trigger suppresses later regions on an inherited player route

## Description

An ordinary board trigger that issues no player movement can silence later regions while the player continues along an existing click route. Later regions must resume under the accepted takeover rule, without allowing trigger-issued movement to recurse into other triggers. The issue owner must resolve the remaining suppression and old-save migration rules before implementation.

## Reproduction

1. Start the selected player at (48, 63) on an authored board with a click destination at (200, 63).
2. Put ordinary step-on regions at x=70..95 and x=120..150, with no *stops movement* flag. Give both short programs that do not queue movement.
3. Click the destination.
4. Actual: the first trigger starts near tick 21 at x=80, the player continues to x=144, and the second trigger does not start near tick 45. Expected: the second region starts when the continuing route enters it.

## Cause Hypothesis

The trigger runtime marks every started trigger as silent, then can keep suppression active until movement becomes idle. That treats the inherited route as trigger-issued movement after a trigger that queued no movement. This is a hypothesis, not a prescribed implementation.

## Acceptance Criteria

1. **An inherited route can trigger later regions after a non-moving trigger**
   **Given** a click route crosses consecutive step-on regions whose programs do not take over movement
   **When** the first program returns and the player continues along the route
   **Then** each later region fires at its normal entry point
2. **Trigger-issued movement remains non-recursive**
   **Given** a trigger program issues player movement
   **When** that movement is processed
   **Then** it does not recursively fire other triggers contrary to the resolved suppression contract, and the first movement takeover clears inherited movement once while later commands in that program retain their normal append/clear behavior
3. **Queue additions and waypoints follow one settled suppression rule**
   **Given** unrelated executions append movement or a trigger queues linked or repeating waypoint movement
   **When** that movement reaches a trigger region
   **Then** the behavior matches the owner-approved suppression lifetime recorded in the normative spec
4. **Save, restore, and recovery preserve takeover continuation**
   **Given** a save or recovery point while a trigger's movement program is active
   **When** execution resumes
   **Then** it preserves whether takeover already occurred and does not lose prior commands; old in-flight saves follow an explicit migration policy that does not invent provenance
5. **Regression coverage proves both sides of suppression**
   **Given** the focused engine and oracle tests
   **When** they run
   **Then** engine and movement-oracle tests cover the reproduction, trigger-issued movement suppression, mixed and newly appended queues, queue-clear/push behavior, waypoints, save/load, recovery, and a real player/engine flow; the oracle manifest, generator, and behavior fixtures agree; negative controls prove that removing all suppression and suppressing inherited movement both fail
6. **Or: no change is needed, with proof**
   **Given** the reproduction
   **When** it runs on the current implementation
   **Then** the expected behavior already holds or the report was mistaken, with evidence recorded in Notes, superseding criteria 1–5

## References

- parent — none; standalone bug for existing issue [#1643](https://github.com/tk-reawakened/rpgtoolkit-reawakened/issues/1643)
- owner decision — `docs/adr/0020-program-movement-takeover.md`
- movement contract — `docs/spec/engine/movement-and-collision.md#reawakened-program-movement-takeover`
- trigger non-recursion — `docs/spec/engine/movement-and-collision.md#r-52`
- inherited click-route contract — `docs/spec/engine/display-input-audio.md#reawakened-click-movement-freeze`
- docs-only owner decision — PR #1680, https://github.com/tk-reawakened/rpgtoolkit-reawakened/pull/1680

## Notes

- Decision: the owner approved **Once on takeover** on 2026-11-07. The first accepted player-travel instruction clears all inherited moves and the continuing waypoint once; later commands in that execution retain normal queue semantics. This is a Reawakened decision, not verified legacy parity.
- Unknown: define the suppression lifetime for unrelated queue additions and linked or repeating waypoints, and reconcile P-8 with R-52. This owner decision is required before refinement.
- Unknown: choose a saveable representation and a migration policy for old in-flight saves that lack movement provenance. No historical fallback has been approved; do not infer one. This owner decision is required before refinement.
- Risk: high because the change affects movement and serialized continuation. Owner review of the suppression reconciliation and old-save migration is the external check before implementation is released.
- Evidence: the issue's report documents a real phase-consumer reproduction; a no-suppression mutation makes the second region fire, while removing suppression altogether is known not to protect trigger-issued movement.
