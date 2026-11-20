---
id: 9
type: spike
title: "Define transaction boundaries for refused linked-edge arrivals"
parent: none
covers: []
after: []
assignee: ""
tracker_id: "#1290"
remote: "https://github.com/tk-reawakened/rpgtoolkit-reawakened/issues/1290"
refined: false
hitl: true
risk: high
---

# Define transaction boundaries for refused linked-edge arrivals

## Description

A linked edge step can complete before the edges phase refuses its destination under R-53, but the sources do not define which movement, trigger, party, queue, or event effects remain. Ticket #1281 waits on a rule that defines the complete transaction boundary; position-only rollback is not enough to establish the other observable effects. The owner must choose the rule before implementation.

## Approach

1. Compare preflighting arrival refusal before the movement commits with completing the step and rolling back all specified effects.
2. Enumerate observable state that can change during the step, including source position, party offsets, remaining queue, triggers, encounter checks, board events, and movement events.
3. Recommend that a refused arrival leave the source-side transaction unchanged, unless the owner explicitly chooses another documented behavior.
4. Record the accepted rule and its event timing in the movement spec, then identify the regression cases ticket #1281 and the edge-transition tests must cover.

## Acceptance Criteria

1. **The candidate transaction strategies are compared**
   Verify: the comparison lists every observable state and event effect, failure point, and whether it can be reversed deterministically.
2. **A deterministic prototype demonstrates the candidate outcomes**
   Verify: fixture output records source position, party offsets, queue, triggers, board events, and movement events for a refused destination.
3. **The accepted contract is recorded before implementation work proceeds**
   Verify: `docs/spec/engine/movement-and-collision.md` specifies the refusal boundary, preserved state, and event timing, and the waiting ticket cites it.
4. **The owner has accepted the contract**
   Verify: a dated owner decision appears in the spec.

## References

- issue — https://github.com/tk-reawakened/rpgtoolkit-reawakened/issues/1290
- waiting ticket — bug-tile-movement-destination-collision.md (#1281)
- spec — docs/spec/engine/movement-and-collision.md, E-138 and R-53

## Notes

- Open question: should arrival refusal be preflighted before a linked-edge step or roll back the full set of observable effects after the step?
- Assumption: a refusal must not leave a partially committed movement transaction; the owner must confirm the exact boundary and event ordering.

- Risk: high — a refused transition can leave movement state and events partially committed; outside this ticket's criteria, verify the selected rule in Epic 5's entry 12 replay and snapshot sweep.
