<!-- Clean-room extraction round 17 (ADR 0006): question list. Answers landed in facts-round-17.md. -->

# Clean-room extraction, round 17 — blocked tile steps and linked board edges

* **Status:** answered and reviewed; see [facts-round-17.md](facts-round-17.md).
* **Date:** 2026-11-21 (approved by the project owner).
* **Why:** owner decisions on #1300 and #1290 depend on what the original engine did; the spec already records E-135 (tile step tested once, at its start) and E-138 (linked step completes, board changes after the movement update).

**R17-Q1.** When a tile step is blocked at its start (wall/vector, solid item, other sprite), what happens to the rest of that actor's queued moves? Cover keyboard steps, queued direction strings, queued points and paths. Is the blocked entry dropped or retried? Are queued directions applied from the actor's actual position, or toward absolute targets?

**R17-Q2.** When another sprite blocks a tile step, does the winner retry on the next update or does its step end? What happens to the loser's and the winner's queues? Is a blocked step counted as a completed step (step counter, step-related events)?

**R17-Q3.** For a linked board-edge crossing, in what order do the step completing, the board change and the arrival position happen? Is the arrival spot tested against the new board's solid areas?

**R17-Q4.** If the destination board is missing or fails to load, the arrival spot is solid, or an entry program cancels the transition, where does the player end up (source position or outside the board), what happens to the queue, and can the next move trigger the edge again?
