<!-- Clean-room extraction round 12: running a named program from the engine (ADR 0006). Review status: REVIEWED. Fact-checked against shipped 3.1.0 (2f986f3e) and final source (9191b919). Two independent clean-room review passes for copied expression and intent (both PASS WITH EDITS; seven implementation-advice and structure remarks removed, unquoted error description; zero copied code or identifiers). -->

# Clean-Room Extraction: Running a Named Program from the Engine

## Versions consulted
- Shipped 3.1.0 release (`2f986f3e`, 2007-09-28)
- Final source (`9191b919`, engine last changed 2010-01-12, never released)

## Status
- **Reviewed and fact-checked** against 3.1.0 (`2f986f3e`) and the final source (`9191b919`).
- **Two independent clean-room review passes** for copied expression and intent across parts 12b and 12c (both **PASS WITH EDITS**; seven implementation-advice and structure remarks removed, unquoted error description; zero copied code or identifiers).
- **Verdict on the core primitive:** Yes. Legacy has a single core primitive: a blocking nested run of a named program, with source and target set by the caller beforehand. It has no variants specific to any one ticket.

---

## 1. The General Model

All points in this section are certain.

1. **Blocking.** The engine starts the named program and waits for it to finish before carrying on. Nothing is queued or delayed. A program can start another program, and nesting can go to any depth.
2. **No arguments.** Starting a program does not pass in a source or target. The caller fills the two engine-wide source and target slots first, and the program reads whatever is in them.
3. **Fresh local state each run.** Each run starts with its own empty local state. Global variables are shared with everything else.
4. **Ignored return.** No engine caller looks at what a program returns.
5. **Contained errors.** An error in a nested program is reported and handled by that program. The caller always carries on afterwards.
6. **Live input between instructions.** Between script instructions, the engine handles at most one pending window message (keeping window repaint, key and mouse input, and window close responsive), while the rest of the world (the normal frame loop, sprite movement, board animations, and background threads) is frozen. See [Section 6](#6-window-responsiveness-during-waits) for behaviour inside waiting commands.
7. **Outermost-only screen capture and message window reset/hide.** Only the outermost program grabs a copy of the screen and hides and resets the message window when it starts, and only it hides the message window when it ends. Nested programs do neither. See [Section 5](#5-message-window-during-nested-runs).
8. **Script handover nesting.** The script command that runs another program ends the current program first, then runs the new one; the old program never resumes. The game-over command does the same when a game-over program is set. However, the old program stays underneath the new one until the new one finishes, so a handover still counts as a nested run (depth grows, and the new program does not recapture the screen or reset the message window). See [Section 7](#7-nesting-depth).
9. **Missing or blank program name.** Some callers check for a name first and skip the run when there isn't one: level-up, win, run, game over, the menu plugin, and board items and board programs (which check the file exists). Other callers run without checking: equip and remove, enemy custom AI, and the battle plugin's special-move and item programs. In those cases legacy behaviour is undefined.

## 2. Source and Target Slots per Use

| Use | Source | Target | Restored afterwards? |
|---|---|---|---|
| Enemy custom AI turn | that enemy | a random living player | No |
| Special move in battle | user | victim | No |
| Item in battle | user | recipient | No |
| Status effect, each round | afflicted fighter | same fighter | No |
| Item used from the menu | the player | the same player | No |
| Ability used from the menu | the user | the chosen player | No |
| Equip and remove | left alone | the wearer | Yes |
| Board item activation | the item | the selected player | Yes |
| Level-up, win, run, game over, startup, board enter, key and link programs | not set | not set | n/a |

Everything in this table is certain.

- **Equip/remove and board items restore afterwards; other rows leave slots set.** Only equip and remove (which leaves the source slot alone and sets and restores the target slot) and board item activation restore the slots afterwards. Where nothing sets the slots or restores them afterwards, the last values stay set in legacy and a program sees whatever was left there last.
- **Menu rows (3.1.0 defect storing wrong value).** This is a legacy defect. On the menu path, a program reading source or target from the menu does not get a usable player; the table shows the player each slot was set from (for an item used from the menu, both source and target are set from the player using it; for an ability used from the menu, source is the user and target is the chosen player).

## 3. Ordering of Battle & Menu Operations

All ordering rules in this section are certain.

- **Special move in battle:** the engine applies the damage and SMP cost and sets the slots. The battle system then plays the animations, runs the program, and applies any status effect after the program returns.
- **Item in battle:** the engine applies HP and SMP and sets the slots, then removes the item from the inventory. The animation and the program come after that.
- **Item from the menu:** HP and SMP are given first, then the program runs, then the item is removed.
- **Status effect:** its program runs on every round tick, not when the effect is applied. The count of remaining rounds goes down after the program returns.
- **Win and run programs:** when several enemies name one, only the last non-empty name is used. The run program runs only after the player escapes. The win program runs after the experience and GP messages.
- **Game over:** the game-over program runs if one is set. Otherwise the player gets a short message and the game resets.
- **Enemy custom AI:** the program replaces the built-in AI for that turn, and the target is picked before it runs.
- **Equip and remove entry paths:** there is one path — the two script commands to equip and to remove an item are the only things that run equip and remove programs. The default menu goes through the same commands: its Equip and Remove options build those script commands and run them, so the menu and scripts behave the same, and the menu has no separate equip logic. Nothing else runs them: battles do not, and loading a saved game puts the equipment and stat bonuses back directly without running any programs.
- **Equip 5-step sequence:**
  1. Takes the item out of the inventory.
  2. Removes whatever is already in that slot. That runs the old item's remove program, takes off its bonuses, and puts it back in the inventory. If the slot is empty, nothing runs.
  3. Checks that the new item can be equipped and that this character may use it.
  4. Adds the new item's bonuses.
  5. Runs the new item's equip program.
- **Equip item-loss hazard:** if step 3 fails, the error comes after the new item was taken and the old one was removed. The new item is lost and the slot is left empty. If the item's file is missing, the command does nothing at all after step 2, so the item is still lost. This is the same in both versions. (For the 3.1.0 menu Equip filename bug, see [Section 8](#8-version-differences).)
- **Remove sequence:** the remove program runs before the stat bonuses are taken off and before the item goes back into the inventory.

## 4. Level-up

- **Order per level gained (certain).** One experience grant that crosses several levels runs the level-up sequence once per level. Each level gained follows this order:
  1. The character's level-up program runs, if one is set.
  2. If the character is below its maximum level, the engine raises the level by one, sets the next experience threshold, and applies the built-in increases to max HP, defence, fight power and max SMP.
  3. The engine shows a short message saying the character gained a level.
- **Cannot skip or replace built-in growth (certain).** The level-up program runs before the level increment and cannot skip or replace the built-in growth. Anything the program changes is applied first, and the built-in growth goes on top. In percentage mode, the percentage is worked out from the stat after the program's changes, minus the bonus from equipped items.
- **What "old values" means when one award crosses several levels (certain).** All of the award's experience is added before the first level-up. The program then runs once per level gained, and each run sees:
  - *Experience:* the full new total, the same on every run.
  - *Level:* the level before this step.
  - *Stats:* the growth from earlier steps in the same award is already included.
  "Old values" therefore means "before this step's growth", not "before the award". Leftover experience beyond each threshold carries over into the next one.
- **Level stored as an ordinary script variable (certain).** A level-up program can change the level itself. The engine then adds one to whatever value the program left, and checks the maximum against that value.
- **At maximum level, the game hangs (certain from the source; not run).** If a character already at maximum level earns enough experience to cross the threshold:
  - The engine runs the level-up program and then skips the growth.
  - It never resets the threshold, so the loop that hands out levels never ends.
  - With a level-up program set, that program runs over and over.
  - With none set, the engine spins in a tight loop and the window stops responding.
  This is the same in both versions.
- **Experience curve in percentage mode (certain).** The increase in the experience needed for the next level is rounded down to a whole multiple of the current requirement. Any percentage under 100 therefore adds nothing, and the requirement stays the same at every level.

## 5. Message Window during Nested Runs

- **One shared window (certain).** The engine has a single message window, shared across runs: whether it is showing, the text already written, and the line where the next text will go are all shared. Programs do not get their own copy, and nesting does not save or restore it.
- **When a program starts (certain).**
  - *Outermost program:* the engine takes a copy of the current screen to use as the backdrop. It then hides the message window and resets it to its first line.
  - *Nested program:* the engine does none of this. It keeps the backdrop it already has and leaves the window exactly as it was. If the caller had text showing, the nested program sees that text.
- **Writing text (certain).**
  - *Window was empty:* the first line is written at the top, after clearing the window to its background colour, and the window is set to showing.
  - *Window already had text:* new text goes on the next line below the existing text. A nested program therefore adds to the caller's message and does not replace it.
  - *Consecutive lines:* when two or more message-window lines come one after another in a program, the engine waits until the last of them before redrawing.
- **Clearing (certain).** If a program clears the window, it is hidden and reset to its first line. Because the window is shared, a nested program that clears it also wipes the caller's text. When the caller next writes, it starts again at the top.
- **When a program ends (certain).**
  - *Nested program:* nothing happens to the window. Any text the nested program wrote is still showing when control returns to the caller, and the caller's next line goes below it.
  - *Outermost program:* the window is hidden. Its line position is not reset at this point. The next outermost program resets it when that program starts, so in practice every top-level run starts with an empty window.
- **Background thread redraw difference (certain).** In the final unreleased source, text written from a background thread no longer triggers an immediate redraw; in 3.1.0 it always did. This does not affect nested runs, because a nested run is never a thread.

## 6. Window Responsiveness during Waits

- **Between script instructions (certain):** the engine handles at most one pending window message. That keeps the window responsive: it repaints from the last drawn frame, it registers key and mouse input, and closing it works.
- **The rest of the world is frozen (certain):** while any program runs, including nested ones, the normal frame loop is stopped. Sprites do not move, board animations and background threads do not advance, and the board is not redrawn except by what the program draws itself.
- **Inside a single command, it depends on the command (certain for the ones listed):**

| Command | Window during the wait |
|---|---|
| Waiting for a key | keeps handling messages |
| Waiting for a mouse click or move | keeps handling messages |
| Screen fades | keeps handling messages |
| Wipes | keeps handling messages |
| Playing an animation | handles messages between frames |
| Scripted walking | keeps handling messages |
| Video | keeps handling messages |
| Delay | handles nothing for the whole delay |

During a delay the window cannot repaint or be closed. Input is only processed after the delay ends.

- **Background threads (certain):** background threads do not handle window messages between their instructions. A delay in a thread freezes the window and the world for its whole length.

## 7. Nesting Depth

- **No engine limit (certain).** There is no limit and no check. Each nested run is an ordinary call that sits on top of the one that started it. Very deep nesting, such as a program that keeps starting itself, eventually exhausts the engine's call stack. Whether that crashes outright or is caught and reported as an unexpected error is not determined from the source.
- **Handing over to another program still nests (certain).** When a script hands over to another program, the old program is told to stop, but it stays underneath the new one until the new one finishes. It does not resume; it just ends straight away. So:
  - *Depth grows anyway.* A chain of programs that each hand over to the next adds a level every time, even though none of them ever resumes.
  - *They count as nested runs.* For the message window, a program reached by a handover does not recapture the screen or reset the window.

## 8. Version Differences

All version differences in this section are certain.

- **Equip from the default menu (3.1.0 vs final source):**
  - *3.1.0:* the equip command finds items by file name only. The menu passes the item's display name, so in 3.1.0 choosing Equip from the default menu fails with an error saying the item is not in the inventory and equips nothing. Remove from the menu works.
  - *Final source:* the command accepts either a file name or a display name, so menu equipping works.
- **Board-item handling:** changed between 3.1.0 and the final source only in sprite collision code, not in how programs run.
- **Background thread message redraw:** in the final unreleased source, text written to the message window from a background thread no longer triggers an immediate redraw; in 3.1.0 it always did. This does not affect nested runs, because a nested run is never a thread.

## 9. Not Verified by Running

These conclusions are from reading the source; the legacy engine was not run:
- the maximum-level hang
- what happens when the call stack runs out
- the 3.1.0 menu Equip error
