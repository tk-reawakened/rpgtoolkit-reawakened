<!-- Clean-room extraction round 18 (ADR 0006): question list. Answers landed in facts-round-18.md. -->

# Clean-room extraction, round 18 — repeat-distance programs, blocked steps and the movement queue

* **Status:** answered, owner-relayed and unreviewed; see [facts-round-18.md](facts-round-18.md).
* **Date:** 2026-11-21 (approved by the project owner).
* **Why:** the spec records what a completed step does, but not how a blocked step counts toward step-activated repeat-distance programs, what the movement queue reports while a step is in progress, or which other systems read the queue.

**R18-Q1.** For a step-activated program with a repeat distance in 3.1.x: when the player presses into a blocked tile, how is the step handled and how much distance is added? Can pressing into a wall re-fire a repeat program? Does the behaviour change when a program drives the player?

a. How much distance does a blocked step add, in tile and pixel mode, and what happens when the blocked destination is outside the program's area rather than overlapping it?

b. After a repeat program fires, can further blocked presses add distance and fire it again? How often, and does a held key change anything?

c. Does the answer change when the player's movement is driven by an ordinary (non-thread) program, by a thread or multitask program, or by a pathfinding move handled by the main loop?

**R18-Q2.** What do PlayerGetPath and ItemGetPath report during a step, in 3.1.x and 3.0.x?

a. During a step, is entry 0 the point currently being walked toward, and does the returned count include it?

b. Does a reported point change if an earlier step was blocked?

c. What do these commands report in 3.0.x?

**R18-Q3.** In 3.1.x, does anything else read queued entries as directions rather than as absolute points, and what happens to the queue across a save and load?

a. Which systems read the queue, and how does each treat an entry? What adds entries and what clears them?

b. When a game is saved and loaded while entries are queued, are the entries restored, recomputed or lost? What happens to a thread paused on a movement?
