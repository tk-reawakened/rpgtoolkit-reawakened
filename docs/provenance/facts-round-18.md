<!-- Owner-relayed fact sheet, clean-room extraction round 18 (ADR 0006). Facts are not rulings; specification changes follow separately (G7). -->

# Clean-room extraction, round 18 — movement queue and blocked steps (owner-relayed)

- **Source consulted:** the answerer read the original program's logic; the behaviour was not observed by running it.
- **Answerer:** TK engineer, relayed by Jensen.
- **Date:** 2026-11-21.
- **Versions:** "3.1.x" covers the shipped 3.1.0 release and the final unreleased source. Nothing in this area behaves differently between them, except one rare case in Q1c (thread wake-up while a custom stance plays). That case is noted there.
- **Confidence:** the answers use three labels: **certain** means every branch was traced; **from source** means read in the source but not run; **guess** is inference.
- **Questions:** [questions-round-18.md](questions-round-18.md), R18-Q1 to R18-Q3: repeat-distance programs and blocked steps; what the queue reports during a step; other readers of the queue and save/load.
- **Drafting:** written to the glass-door rule: no code, identifiers, file names, line numbers or quoted wording.
- **Review:** Owner-relayed; has NOT had the two independent reviews (copied-expression review and fact-check at both revisions) a full round gets; decisions resting on it may proceed but a review pass should follow.
- **Correction to round 17:** [facts-round-17.md](facts-round-17.md) says a blocked step's entry is dropped for "the player". That is true only for the selected (user-controlled) player; Q2b below records how items and other players behave.

Terms
- A step is one queued movement.
- A tile-mode step is 32 pixels.
- A pixel-mode step is a small distance of 1 pixel or more, set by the movement speed.
- Distance is the running counter kept for each step-activated program.

## Q1: repeat-distance programs and blocked steps (3.1.x)

How a blocked step is handled. When the player presses into a blocked tile, the step ends immediately. The player does not move, and the queued entry is removed. The step still counts as finished, so the normal "player finished a move" processing runs: the step counter goes up by one step's worth, and the program and encounter tests run. Those tests use the position the player tried to reach, not where the player is standing. (from source)

a. How much distance is added? One step's worth, whatever the number of pixels actually moved. (from source)
- Tile mode adds 32. Pixel mode adds the pixel-step size.
- This happens only if the blocked destination overlaps the program's area. The overlap test is any contact with the area, not full containment.
- If the blocked destination is outside the area, the counter is reset, not increased. A repeat program is set to "ready to fire on entry". A non-repeat program is set to 0.

b. Can pressing into a wall re-fire a repeat program? Yes. (from source)
- After a repeat program fires, its distance resets to 0.
- Every blocked press whose destination overlaps the area adds one step's worth. The program fires again when the total reaches the repeat distance.
- In tile mode, a repeat distance of 32 or less fires on every blocked press. A distance of 64 fires on every second press.
- A held key repeats the press every frame, because a blocked step returns the game to accepting input at once. A wall-pressing player can therefore fire the program once per frame.
- A second route also exists. A press toward a destination outside the area leaves the program "ready to fire". The next press whose destination overlaps the area then fires it, with no walking in between.

c. Does it change when a program drives the player? It depends on how the movement is run.

| Movement source | Behaviour |
|---|---|
| Ordinary (non-thread) program, blocking movement commands | The finished-move processing never runs. Distances are not touched and no programs fire, whether blocked or not. (from source) |
| Thread or multitask program, with or without the pause-thread flag | Same as free-roaming, including the re-firing in 1b. Thread-driven player movement triggers programs and encounters. (from source) |
| Pathfinding moves (mouse click, step-towards, pathfound path), handled by the main loop | Only other sprites can block these, not board vectors. The program and encounter tests also run on every frame of the walk. Each frame adds a whole step's worth, so repeat programs and encounters fire much sooner than the real walked distance suggests. (from source) |

One version note: the final source stops a thread's movement-wait from being released while a custom stance plays. 3.1.0 releases it. This only matters to threads paused on a movement.

## Q2: what the queue reports (3.1.x and 3.0.x)

PlayerGetPath and ItemGetPath copy the pending queue.
- With only a handle, they return the number of entries.
- With an index and two variables, they write the entry's x and y, rounded to whole pixels.
- An index past the end writes nothing. (from source)

a. Entry 0 during a step. Entry 0 is the point currently being walked toward, and the count includes it. (certain)
- The entry is removed only when its step ends, so the next queued entry is index 1 until then.
- Two exceptions: in pixel mode, sliding along a wall changes the real walking target but not the stored entry, so the reported point can differ from where the sprite is heading. Waypoint-link board paths are not in this queue, so they report a count of 0. (from source)

b. Does a reported point change if an earlier step was blocked? No. The reported point stays as first computed. (certain)
- When a direction is queued, it is converted to an absolute point. The point is the last queued point (or the current position if the queue is empty) plus one step.
- Nothing rewrites existing entries afterward. A blocked step only removes its own entry.
- The walk does change. The direction of each step is recalculated from the current position when the step starts. After a blocked step, a later entry is approached from where the sprite actually is, possibly on a diagonal. The reported point is unchanged.
- The one exception is collision avoidance for pathfinding moves. It can replace the front of the queue with a detour and keep the rest.

Corrected from Round 17. The statement "a blocked entry is dropped" is true only for the selected (user-controlled) player. For items and other players, a blocked step is not treated as finished. The entry stays at the front and is retried every frame. A thread waiting on that movement is not released while it is blocked. For pathfinding moves, a failed detour clears the whole queue instead. (from source)

c. 3.0.x. Nothing is reported, because these commands do not exist in 3.0.x. (certain, searched the whole 3.0.x source)
- The 3.0.x queue holds relative direction codes, one per step.
- A code is removed as its step starts, so the step in progress is never in the queue.
- Pixel-push mode expands each tile-sized move into several small steps.
- No script command reads the queue. The 3.0.x PathFind command returns a freshly computed route, not the pending one.

## Q3: other readers of the queue (3.1.x)

a. Does anything else read entries as directions? No. (from source) Every reader treats entries as absolute pixel points or checks only whether the queue is empty. Direction of travel and facing are derived from the difference between the sprite's position and its target. The readers are:
- Starting and ending a step.
- Waking a thread that is waiting on movement. This checks emptiness only.
- Idle-animation timing, which checks emptiness only.
- Sprite-collision priority, which checks whether the other sprite has movements.
- Wander, which checks whether the item is already moving. It also uses the last queued point as the starting spot.
- Collision avoidance, which uses entries as goals.
- The path overlay, which draws lines between absolute points. It shows only for the selected player and only for pathfinding moves, so pushed (direction) queues draw nothing.
- The destination circle, which uses the last entry.

Push and the path commands only add entries. Clearing happens through MultiRun start, programs and items flagged to stop movement, item activation, and setting a sprite's position. (from source)

b. Saving and loading with entries queued. The queue is not saved, so the entries are neither restored nor recomputed. They are lost. (certain)
- A save stores each sprite's position, layer and active flag, plus its waypoint board-path settings. It does not store the queue, the current target, or any in-progress step.
- Loading sets each sprite's position, which empties its queue. Items are rebuilt with empty queues. Player positions load truncated to whole pixels.
- A thread paused while waiting on a movement is saved with an indefinite sleep. Loading treats an indefinite sleep as "not sleeping". That thread resumes immediately, and the sprite no longer remembers the thread. A movement-wait does not survive a save and load. (from source)
