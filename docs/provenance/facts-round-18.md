<!-- Owner-relayed fact sheet, clean-room extraction round 18 (ADR 0006). Facts are not rulings; specification changes follow separately (G7). -->

# Clean-room extraction, round 18 — repeat distance, queue reporting, queue readers (owner-relayed)

- **Source consulted:** the answerer read the original program's logic; the behavior was not observed by running it.
- **Answerer:** TK engineer, relayed by Jensen.
- **Date:** 2026-11-21.
- **Versions:** released 3.1.0 and the final unreleased source; no difference between them except where noted in S3. 3.0.x is covered for the queue-reporting question only.
- **Confidence:** from source unless marked *certain*. Timing-related parts are not measured.
- **Questions:** how blocked steps feed repeat-distance programs; what the path-query commands report during a step; what else reads the queue, and what a save keeps of it.

Terms: a **step** is one queued movement (32 pixels in tile mode, a small pixel-mode distance otherwise). **Distance** is the running counter kept for each step-activated program.

## Repeat-distance programs and blocked steps (3.1)

**S1. A blocked step still counts as a finished move.** Pressing into a blocked tile ends the step at once, the player does not move, and the queued entry is removed. The normal finished-move processing runs: the step counter rises by one step's worth, and the program and encounter tests run. Those tests use the position the player *tried* to reach, not where the player stands.

**S2. A blocked step adds one step's worth of distance, never the pixels moved.** This applies only when the blocked destination's base touches the program's area (any contact counts, not full containment). Tile mode adds 32; pixel mode adds the pixel-step size. If the blocked destination is outside the area, the counter is reset instead: a repeat program becomes "ready to fire on entry", a non-repeat program is set to 0.

**S3. Pressing into a wall can re-fire a repeat program.** After a repeat program fires its distance is 0. Each blocked press whose destination touches the area adds one step's worth, and the program fires when the total reaches the repeat distance. In tile mode a repeat distance of 32 or less fires on every blocked press; 64 fires on every second press. A held key repeats the press every frame, because a blocked step returns the game to accepting input immediately. Separately, a press toward a destination outside the area leaves the program ready, and the next press whose destination touches the area fires it with no walking in between.

**S4. Program-driven movement.**

| Movement source | Behavior |
|---|---|
| Ordinary (non-thread) program, blocking movement commands | Finished-move processing never runs; distances are untouched and no programs fire, blocked or not. |
| Thread or multitask program, with or without the pause-thread flag | Same as free-roaming, including S3. Thread-driven player movement triggers programs and encounters. |
| Pathfinding moves (mouse click, step-towards, pathfound path) handled by the frame loop | Only other sprites can block them, not board vectors. The program and encounter tests also run every frame of the walk, each adding a whole step's worth, so repeat programs and encounters fire much sooner than the real walked distance suggests. |

One version note: the final source does not release a thread's movement-wait while a custom stance is playing; 3.1.0 does. This matters only to threads paused on a movement.

## What the path-query commands report (3.1 and 3.0)

**S5. What the commands return.** With only a handle they return the number of queued entries. With an index and two variables they write that entry's x and y, rounded to whole pixels. An index past the end writes nothing.

**S6. Entry 0 during a step is the point currently being walked toward** (*certain*), and the count includes it. An entry is removed only when its step ends. Two exceptions: in pixel mode, sliding along a wall changes the real walking target but not the stored entry, so the reported point can differ from where the sprite is heading; and waypoint-link board paths are not in this queue, so they report a count of 0.

**S7. A reported point does not change when an earlier step is blocked** (*certain*). A queued direction is converted to an absolute point when queued: the last queued point (or the current position if the queue is empty) plus one step. Nothing rewrites existing entries afterward; a blocked step removes only its own entry. The *walk* does change, because each step's direction is recalculated from the current position when the step starts, so a later entry may be approached on a diagonal. The one exception is collision avoidance on pathfinding moves, which can replace the front of the queue with a detour and keep the rest.

**S8. Correction to round 17: "a blocked entry is dropped" holds only for the selected (user-controlled) player.** For items and other players a blocked step is not treated as finished: the entry stays at the front and is retried every frame, and a thread waiting on that movement is not released while it is blocked. For pathfinding moves, a failed detour clears the whole queue instead.

**S9. 3.0.x reports nothing; the commands do not exist** (*certain*; the whole 3.0.x source was searched). The 3.0.x queue holds relative direction codes, one per step, each removed as its step *starts*, so the step in progress is never in it. Pixel-push mode expands each tile-sized move into several small steps. No script command reads the queue; the 3.0.x PathFind command returns a freshly computed route.

## Other readers of the queue, and saving (3.1)

**S10. Nothing treats entries as directions.** Every reader uses entries as absolute pixel points or only checks whether the queue is empty. Direction of travel and facing come from the difference between the sprite's position and its target. Readers: starting and ending a step; waking a thread waiting on movement (emptiness only); idle-animation timing (emptiness only); sprite-collision priority (whether the other sprite has movements); Wander (emptiness, and the last queued point as the starting spot); collision avoidance (entries as goals); the path overlay (lines between absolute points, selected player only, pathfinding moves only, so pushed direction queues draw nothing); the destination circle (last entry). Push and the path commands only add entries. Clearing happens through MultiRun start, programs and items flagged to stop movement, item activation, and setting a sprite's position.

**S11. A save does not keep the queue, so entries are neither restored nor recomputed** (*certain*). A save stores each sprite's position, layer, active flag and waypoint board-path settings, but not the queue, the current target or any in-progress step. Loading sets each sprite's position, which empties its queue. Items are rebuilt with empty queues. Player positions load truncated to whole pixels.

**S12. A movement-wait does not survive a save and load.** A thread paused while waiting on a movement is saved with an indefinite sleep. Loading treats an indefinite sleep as "not sleeping", so that thread resumes immediately and the sprite no longer remembers it.

## Not verified by running

All answers were read from the source and none were run. Frame-rate and held-key timing are from source, not measured. The per-frame program firing during pathfinding walks is from source and consistent with earlier rounds.
