<!-- Owner-relayed fact sheet, clean-room extraction round 17 (ADR 0006). Facts are not rulings; specification changes follow separately (G7). -->

# Clean-room extraction, round 17 — whole-tile movement: blocked steps, queues, board-edge crossings (owner-relayed)

- **Source consulted:** not stated in the relay; the sheet distinguishes what was read from what was not determined.
- **Answerer:** not stated; behaviour prose relayed by the owner (Jensen).
- **Date:** 2026-11-21.
- **Versions:** the sheet separates a "newer runtime" (3.1.x) from an "older runtime" (3.0.x); revision identifiers were not supplied.
- **Confidence:** the sheet's own `certain` and `probable` tags, preserved verbatim, including where a consequence is certain from the arithmetic but the behaviour in play is only probable.
- **Questions:** R17-Q1 to R17-Q4, in the sheet below.
- **Review:** not reviewed by a separate agent; the owner-relayed prose is recorded as given, with no ruling added.

Terminology used below (mine, not the original's):
- "newer runtime" = the native rewrite shipped as 3.1.x; "older runtime" = 3.0.x.
- "direction-style entries" = keyboard steps and queued direction strings (push-type commands).
- "point-style entries" = queued points, step-toward-a-location commands, wander, mouse/path-found routes, board-assigned paths.
- "the player" = the currently selected (user-controlled) player; "other actors" = items and non-selected players.

## R17-Q1 — what happens to the rest of the queue when a tile step is blocked at its start

### Newer runtime (3.1.x)

How queued entries are stored (certain):
- Every queued entry, including direction-style entries, is stored as an absolute pixel target, not as a relative direction. When a direction is queued it is converted on the spot to "last queued destination plus one tile in that direction"; if the queue is empty at that moment, the starting point is the actor's current position. Keyboard input always empties the queue first and queues exactly one entry, so keyboard steps are always one tile from where the player currently stands.
- When an entry starts, the movement vector is recomputed from the actor's *actual* current position toward that absolute target, scaled so the larger axis component is one unit. The step ends when the actor passes (or reaches) the target on either axis, at which point it is snapped onto the target (unless the target tile was solid, in which case no snap happens).
- Consequence (certain from the arithmetic; behaviour in play probable): if a direction-style entry is dropped because it was blocked, later entries still aim at absolute points that assumed the dropped step succeeded. Example: a queued East then North, with East blocked, makes the second entry travel diagonally north-east one tile. East, East with the first blocked makes the second entry travel two tiles east as a single step. Queued directions are therefore effectively applied toward absolute targets, not from the actor's actual position.

What is tested at step start (certain):
- Direction-style entries: board walls/solid vectors are tested at the target position only (the actor's base placed at the destination), plus other sprites (players and items, all of which are solid) at the destination. Only the destination is tested, so with the two-tile example above the actor can pass over an intermediate solid tile if the far tile is clear [probable; follows from the destination-only test]. For the player only, the board edge is also tested: stepping off an edge that has no link counts as solid.
- Point-style entries: board walls are NOT tested at all during movement (the route is assumed to have been planned around them); only other sprites are tested, and that test is repeated during the step roughly once per pixel travelled.
- A further quirk (certain): the style is a single per-actor flag (it belongs to the actor's movement state, not to each queued entry). Queuing any direction-style entry switches the actor into direction-style handling; it only returns to point-style handling when the actor goes fully idle with an empty queue. Point entries queued behind direction entries are therefore handled with direction-style rules.

Blocked direction-style entry, player (certain):
- The blocked entry is consumed and dropped (not retried). This takes a single update: the player turns to face the direction, its animation frame may advance, but it does not move. The step is marked finished, the remaining queue continues with the next entry on the following update.
- Outside of a program-driven movement, the dropped step is also treated as a completed step (see R17-Q2).

Blocked direction-style entry, other actors (certain):
- The entry is NOT dropped and NOT consumed. The actor stays idle and the same entry is re-tested on every update until it becomes clear; the rest of the queue waits behind it indefinitely. A program waiting for that actor's movement to finish (pause-until-done option) stays paused for as long as the blockage lasts, possibly forever. A non-threaded program that drives the movement synchronously stops driving it as soon as the actor is stuck (the synchronous loop ends), but the entry stays queued and the main loop keeps retrying it.
- Other actors are never tested against board edges, so they can walk off the board.

Blocked point-style entry (another sprite in the way — walls do not block point entries): handled by the precedence/diversion rule described in R17-Q2. In summary: the actor either detours (its queue is replaced by a detour route plus the rest of its old points), waits and retries (queue intact), or abandons its entire queued point list. Board-assigned looping paths are never abandoned: if no detour is found the same waypoint is retried on later updates. Applies to player and other actors, except that the player always wins precedence against a moving sprite.

### Older runtime (3.0.x)

- Queues hold relative directions. Each entry is removed from the queue when it starts and its target is computed from the actor's current tile origin, so queued directions are applied from the actor's actual position (certain).
- Blocked at start (solid tile at target, or a sprite whose position/target occupies the target, or for the player an off-edge with no usable link):
  - Player (selected or not): the entry is consumed; the actor "walks on the spot" for the full normal duration of a step without moving, then the step ends and the next queued entry begins. Not retried (certain).
  - Items: the step can never finish. The blocked state is fixed when the step starts, so the item stays stuck on that entry permanently and the rest of its queue never runs; a program synchronously driving item movement never regains control (probable — follows directly from the logic, not observed).
- There is no detour/precedence system in the older runtime.

## R17-Q2 — sprite-vs-sprite blocks: who retries, what happens to queues, does it count as a step

### Newer runtime (3.1.x)

Direction-style entries (keyboard / direction strings) (certain):
- There is no winner/loser logic. Another sprite at the destination is treated exactly like a wall.
- Player: the blocked step ends immediately and the entry is dropped; the rest of its queue proceeds.
- Other actors: retry the same entry every update; their queue waits. Two such actors pushing into each other wait on each other indefinitely.
- The other (blocking) sprite is not affected at all.

Point-style entries (certain unless marked):
- Precedence is decided in this order:
  1. If the blocking sprite has nothing queued (no points and no board path), the moving actor wins.
  2. Otherwise, if the moving actor is the player, it wins.
  3. Otherwise, if the blocking sprite is the player, the blocking sprite wins.
  4. Otherwise the faster sprite wins (fewer frames per step).
  5. At equal speed, the sprite that comes earlier in the current draw (depth) order wins over the one drawn after it.
- Winner side (the moving actor won): it tries to find a detour — a route that avoids sprites — to each of its remaining queued points in turn (the final point is attempted with "give up if the goal itself is occupied").
  - Detour found: its queue becomes the detour followed by the remaining original points after the one reached; the blocking sprite is frozen for 2 seconds (even if it is in the middle of a step; it resumes toward its own unchanged target afterward). The winner does not move on this update; it starts the detour on the next update.
  - No detour: its entire queued point list is discarded and the current step ends where the actor stands. If this happens mid-step the actor is not snapped to a tile — it can be left between tiles [probable]. For board-assigned paths nothing is discarded and the same waypoint is retried on later updates.
- Loser side (the moving actor lost): the actor's own queue is left untouched. It asks the *winning* sprite to find a detour around it.
  - If the winner finds one, the winner's queue is replaced by that detour (plus its remaining points) and the losing actor is frozen for 2 seconds, then retries its unchanged entry.
  - If the winner cannot find one, the winner's queued point list is discarded (the winner stops), and the loser retries on the next update without freezing.
- So: the loser always retries (after a 2-second pause if the winner detoured); the winner's step either becomes a detour or ends with its queue cleared.
- While frozen, a sprite does nothing at all (no movement, no idle handling).

Is a blocked step counted? (certain)
- There is one global step counter and it only applies to the player; other actors have no step counter and never trigger step-related events.
- For the player, when a step ends while the game is in normal free-roaming movement (not while a program is synchronously running the movement), the "step done" handling runs: the counter is increased by one tile's worth, step-activated programs and item activations are tested, and the random-battle test is performed. This happens whether the step actually moved or was blocked (the step is flagged finished in both the blocked and the completed case). The program/item test is evaluated at the step's *intended* destination, so pressing into a blocked tile can trigger a program or item located on that tile.
- When the player's movement is driven synchronously by a non-threaded program, the "step done" handling does not run at all (neither for completed nor blocked steps). Thread-driven movement runs in the main loop and does count.
- Quirk: for the player on point-style routes, the "step done" handling is flagged on every movement update rather than once per tile [certain from logic; effect on counter in play probable].

### Older runtime (3.0.x)

- No precedence or detours. Sprites are processed in a fixed order (all players, then all items) each update (certain).
- At step start, the target is blocked by: any visible other player whose current position or target overlaps the target tile; any active item (conditionally-active items only when their condition holds) whose target overlaps, or whose current position overlaps if that item is idle.
- During the step (tile movement), each frame tests the in-between position against other sprites' current positions. If the overlapping sprite is moving, the actor simply waits that frame (retries next update, no progress). If the overlapping sprite is idle, the step is converted into a blocked step: players walk on the spot to the end of the step and are left wherever they had reached (probable), items become permanently stuck (probable).
- Loser's queue: players — blocked entry consumed, rest continues; items — stuck on the entry, rest never runs. The other sprite's queue is never touched.
- Counting (certain): every time the selected player finishes a step — moved or blocked, free-roaming or program-driven — the step counter increases by one, programs at the intended target are tested, and the battle test runs (every step in tile movement). Other actors never count.

## R17-Q3 — order of events for a linked board-edge crossing; arrival collision test

Applies to the player only in both runtimes; other actors never trigger board changes (certain).

### Newer runtime (3.1.x) — certain unless marked

Order:
1. The step starts; because the edge has a linked board, the edge test does not block it, and the player begins moving (the first frame of movement is applied, so the player moves a few pixels toward the edge).
2. On the same update, after all sprites have moved, the edge handler sees that any part of the player's base at the step's target lies off the board and performs the crossing immediately — the step is never walked to completion.
3. If the link is a program file rather than a board, that program is run instead and nothing else happens (the step continues and the handler can fire again on later updates while the target is still off-board) [probable].
4. The destination board is loaded into a temporary board.
5. The arrival position is computed: the coordinate perpendicular to the edge is kept from the player's current position; the other coordinate is placed against the opposite edge of the new board, grid-aligned (normal boards: north crossing puts the player one tile above the bottom edge; south one tile below the top, east one tile in from the left, west against the right edge using the player's base width rounded up to whole move-grid units; isometric boards use half-tile adjustments). The layer is kept.
6. The player is placed there, which also clears its entire movement queue and sets it to "just finished moving".
7. Arrival check (see below). If it fails, the crossing is undone (R17-Q4).
8. On success the temporary board is discarded and the real current board is reloaded from the destination file; the view is aligned; sprites are re-sorted; route-finding data is reset; any step-activated single-trigger programs under the arrival spot are disarmed so they do not fire until the player leaves them; the board music starts; then the destination's "on enter" program runs.
9. The game returns to accepting input. The "step done" handling (step counter, program and battle tests) does NOT run for the crossing step.

Arrival test (certain):
- The arrival spot is rejected if it lies beyond the new board's width or height, if the player's layer exceeds the new board's layer count, or if the new board's walls/solid vectors at the arrival spot add up to exactly "solid". Only board vectors are checked. Sprites and items on the new board are not checked. A spot that is solid combined with some other area type (e.g. stairs) is not treated as solid, because the comparison is exact [certain from logic].

Edge-case notes:
- If the player's movement is being driven synchronously by a non-threaded program, the edge handler is not run during that program; the player can walk off the board, and the crossing happens on the first main-loop update after the program ends [probable].
- For the player on a point-style route, the edge test uses a point one tile ahead along the current direction, so a route ending on the edge row/column moving toward the edge can trigger the crossing early [probable].

### Older runtime (3.0.x)

Order (certain for the sequence of operations; probable for the caller's treatment of the cancelled step):
1. At step start (before any movement frame), the target tile type and sprite obstructions are evaluated, and the edge test always runs as well.
2. If the target is off the edge and a board link exists, the destination file is read into a temporary board and the arrival tile is computed: north → bottom row of the new board, south → top row, east → first column, west → last column (same other coordinate, same layer; isometric boards adjust the row by parity).
3. Arrival is rejected if outside the new board's dimensions/layers, or if the new board's tile type at that tile is solid (tile types only; items not checked).
4. On success the player is placed there immediately, with its pending target set equal to its position and its direction set to idle, so the current step is effectively cancelled (no walk-in animation, no step completion [probable], no step count/program/battle test [probable]). Then non-persistent threads are stopped, item sprites destroyed, the board loaded, the animation cache cleared, the view realigned, items opened, the screen rendered, board threads launched, and finally the "on enter" program runs. Input is accepted again.
5. The player's remaining queue is NOT cleared; the next queued entry runs on the new board.
- A program link runs the program and the step is then treated as blocked.
- Only the selected player is ever tested; party members are blocked at the edge.

## R17-Q4 — failed crossings: missing board, solid arrival, entry program

### Newer runtime (3.1.x)

Solid arrival / board too small / layer too high (certain):
- The player is put back at the position it had when the crossing was attempted, which is inside the source board — but this is the position after the first movement frame, so the player can be left a few pixels off the tile grid toward the edge [probable — follows from the order of operations].
- Its movement queue is cleared (placing the player discards the queue both when moving to the arrival spot and when restoring) and the sprite is marked as having finished its movement. The restore branch itself does not explicitly return the game to the accepting-input state; whether the game state is already idle at that point was not determined.
- The failed attempt is not counted as a step and no program or battle test runs from that branch.
- The next move toward the edge triggers the whole attempt again (load, compute, check); nothing remembers the failure.

Missing or unloadable destination board (certain for the load behaviour, not determinable for the rest):
- The load result is ignored by the crossing code. A missing file produces a user-facing message box naming the file; an outdated-format board produces a message box asking the author to re-save it in the editor. In those cases the load stops before any size information is read, so the temporary board's dimensions stay at whatever a fresh board holds — not determinable from what was read. The normal expectation is that the arrival check then fails and the player is restored as above (queue cleared, retried on every new attempt, message box shown every time). If the check happened to pass, the real board load would also fail (message box again, current board left intact) and the player would be placed at the computed coordinates on the unchanged old board, with the old board's enter program re-run — a case the original does not handle deliberately.

Entry program "cancelling" (certain):
- There is no cancellation mechanism. The "on enter" program runs only after the board has been switched, the player placed and its queue cleared. Whatever the program does (e.g. sending the player elsewhere) is just ordinary later behaviour; the original does nothing special.

### Older runtime (3.0.x)

- Solid arrival / out-of-range arrival / no link / program link: the step is treated as blocked — the player walks on the spot for one step's duration on the source board, its position is unchanged (inside the board), and then the step ends normally, which counts as a step and runs program and battle tests at the off-board target (certain). The rest of the queue is kept and continues (certain). The next move toward the edge retries the crossing (certain).
- Missing board file (probable, not fully determinable): the temporary board is first reset to a default 20 by 15 blank board, then the file is opened in a mode that does not fail on a missing file, so the header check fails and a message box asks for a re-save; the load stops there with the default blank board in place. The arrival check is then made against a 20 by 15 board with no solid tiles, so it passes whenever the arrival coordinates fit inside 20 by 15. In that case the crossing proceeds: the real board load runs the same failing path, so the active board is reset to a blank 20 by 15 board, the message box appears again, and the player stands on that empty board. If the arrival coordinates do not fit, the step is treated as blocked as above. (Contrast with the newer runtime, where the message box and failed load leave the current board intact.)
- Entry program: runs after the board switch and placement; no cancellation; the original does nothing special (certain).
