# Proposed amendment: UI state at board entry

**Status:** spec gap, pending owner ruling.  
**Related defects:** title-screen message window and screen text persist over the first board.  
**Anchors:**
- `docs/spec/engine/main-loop-and-startup.md` `#reawakened-board-entry` (lines 83-84) lists board-entry steps; clearing `ui` is not one of them.
- `docs/spec/engine/main-loop-and-startup.md` `#reawakened-reset-sections` (E-06) clears `ui`, but that is the `reset()` path, not a normal `send`/edge transition.
- `docs/spec/engine/rpgcode-functions.md` under `executeProgram` (line 122) says the outermost program hides/resets the message window when it starts and hides it when it ends; it does not address the screen-text draw list.

## Observation

The shipped `fixtures/legacy/demo/Prg/start.prg` title screen works like this:

1. `drawTitle()` calls `clear()` and then `text(3, 3, "Test Game")`.
2. The menu loop draws `text(17, 10.5, "New Game")`, `text(17, 12, "Load Game")` and `text(17, 13.5, "Quit")`.
3. Choosing "New Game" calls `intro()`, which does `mwin("Your story goes here...")` and `wait()`.
4. After `intro()` returns, the switch case calls `end()` and the startup program terminates.
5. The engine then enters `initBoard` (`boards/start.brd`).

`clear()` blanks the render-now canvas (E-56), but `text()` without a canvas handle appends to the screen-text layer (`ui.draws`).  `mwin()` shows the message window.  When the board appears, those two layers are still present, so the title text and message window are drawn on top of the room.

## Proposal

Add a board-entry rule to `main-loop-and-startup.md#reawakened-board-entry`:

> On every arrival at a board (boot, `send`, or edge link), after the old board's threads are stopped and before the board's threads start, clear the transient screen UI that belongs to the previous screen: hide and empty the message window (`ui.message`), clear the screen-text draw list (`ui.draws`), and reset per-screen cursor/button selection. Preserve author-configured settings: the active font (`ui.font`), text colour (`ui.color`), underline flag, message-window colour/translucency/graphic, and any cursor-map definitions (`ui.cursorMaps`, `ui.nextCursorMapId`, `ui.cursorHand`, `ui.mouseCursor`).

This matches the spirit of E-06's `ui` reset action but is narrower, because board transition is not `reset()` and should not restore project defaults.

## Why this is needed

Without this rule, a title screen that uses `text()`/`mwin()` leaves those draws on screen when the first board loads.  The original title screen relies on the engine to reset the display at the transition; it does not call `mwincls()` or otherwise clear `ui.draws` before `end()`.  A ruling here lets the golden re-record for the UI clear proceed with a spec anchor rather than an invented behavior.
