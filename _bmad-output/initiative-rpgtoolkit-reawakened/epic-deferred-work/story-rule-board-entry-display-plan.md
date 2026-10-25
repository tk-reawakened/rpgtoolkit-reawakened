---
id: 3
type: story
title: "Rule first-board and no-board display behavior"
tracker_id: "#642"
remote: "https://github.com/tk-reawakened/rpgtoolkit-reawakened/issues/642"
parent: epic-deferred-work
status: blocked
blocked_reason: "Awaiting owner rulings on first-board clearing and no-board background behavior."
hitl: true
context: ["spec - docs/spec/engine/display-input-audio.md, docs/spec/engine/main-loop-and-startup.md", "ledger - deferred-work.md lines 196-203"]
---

# Rule first-board and no-board display behavior

## Human decisions required
1. When the first board is entered, should startup text and the message window be cleared? Choose the intended behavior for each separately.
2. When there is no board to render, should the frame be black or transparent?

## Acceptance
1. Record an owner-approved answer for each question in the normative rendering specification.
2. Record the rejected alternative and any behavior intentionally deferred.
3. Do not implement display behavior in this decision ticket; create a separate implementation ticket only after the ruling is documented.

## Verification
The specification states the chosen behavior as deterministic rules and includes a regression-test expectation for each decision.
