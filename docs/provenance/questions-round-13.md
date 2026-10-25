<!-- Clean-room extraction round 13 (ADR 0006): question list. Answers, if obtained and reviewed, land in facts-round-13.md. -->

# Clean-room extraction, round 13 — running a program: the questions round 12 left open

* **Status:** not yet sent. No answers have been received. Nothing in this file is a fact about Toolkit 3.1.
* **Date:** 2026-10-25
* **Process:** [ADR 0006](../adr/0006-clean-room-spec-extraction.md) decision 2. The owner should forward this numbered list to the TK-side engineer and ask for short answers from memory, limited to the numbered questions. The answerer should describe behaviour in prose, not source code or the structure of the old program. A separate reviewer must check the returned prose, for copied expression **and** for the facts, before it enters `docs/`. Round 12 had only the first of those two checks ([facts-round-12.md](facts-round-12.md), Status); please also give the source revision ids this time.
* **How answers land:** after the owner relays the answers, the reviewed prose goes in `facts-round-13.md`, with the answerer's confidence label preserved, and the completed round gets one row in [extraction-log.md](extraction-log.md). This question-list commit does not record answers or claim legacy parity.
* **Scope:** these are the points the round 12 text left ambiguous, contradictory or unchecked, taken from the independent reviewer's findings. The behaviour round 12 states as certain (a blocking nested run, fresh locals, shared globals, errors handled by the called program, the equip/remove/board-item restore, the hand-over of `run`) is not re-asked.
* **Terms.** The *source slot* and the *target slot* are the two engine-wide values round 12 describes. The *use table* is the table in [facts-round-12.md](facts-round-12.md#what-the-source-and-target-slots-hold-at-each-use).

The defaults below are the Reawakened rules currently in force. Where nothing is ruled yet, the default says so and quotes the **proposed** rule (pending owner review) instead; a proposed rule is not in force. An answer that differs from a default does not change implementation by itself: first amend the cited `docs/spec/` rule in a documentation pull request.

## Priority 1 — the uses whose slots are unresolved

### 1. Item or special move used from the menu

**Question for the TK-side engineer.** The use table gives one row for "item or special move used from the menu": source "the user (an item's source and target are both the player using it)" and target "the chosen player", marked fairly sure. Which cell applies to which? Concretely, for an **item** used from the menu on party member B while A has the menu open, what do the two slots hold when the item's menu-use program runs? And for a **special move** used from the menu on member B by member A? Is the target ever "nothing" (for example when a move needs no target)?

**Affects.** The menu-use program of an item and the program of a special move used from the menu; the item-menu and abilities-menu providers ([E-80](../spec/engine/plugins-and-battle.md#e-80)); the `callProgram` use table of the proposed rule in `rpgcode-functions.md`.

**Reawakened default now in force.** None: no `docs/spec` rule says what a menu use sets. E-80 says only that a menu facade command runs as a nested call that keeps the caller's source and target. The proposed `callProgram` rule (pending owner review) repeats round 12's row as stated and marks it unresolved.

**If the answer differs.** Fix the menu row of the proposed table before any code reads it; if the answer is "item: both slots are the member it is used on; special move: user and chosen member", say so in one sentence per case.

### 2. Board item: what "the currently selected player" is

**Question for the TK-side engineer.** Please confirm that when the player activates an item on a board, the source slot is the item and the target slot is the player. With a party of several members, which player is "currently selected": the member whose collision base touched the item or pressed the key, the member the camera follows and the mouse moves (the party's active member), or the first party slot? Does it matter whether the item was stepped on or activated by a key press?

**Affects.** Item activation ([E-43](../spec/engine/movement-and-collision.md#e-43), which today says `source` = item and `target` = the player); the board-item row of the use table.

**Reawakened default now in force.** E-43: `source` = the item and `target` = the player during the program; THR-2 restores the previous values when it ends. The docs use "the selected player" for the member the camera and mouse movement follow ([E-25](../spec/engine/movement-and-collision.md#e-25), [E-51](../spec/engine/movement-and-collision.md#e-51)), which is not necessarily the member that touched the item.

**If the answer differs.** Amend E-43's target wording to name the member precisely.

### 3. Level-up: growth after the program, "old values" and several levels

**Question for the TK-side engineer.** (i) After a character's level-up program has run, does the built-in stat growth (maximum HP, DP, FP, maximum SMP) still happen in the same level-up, or does the program replace it? (ii) Round 12 says the program runs before the level number goes up and so "sees the old values". Which values are old: the level number only, or also the stats and the experience? If the program reads the experience, is the award already added? (iii) When one award crosses several thresholds, the program runs once per level. Does the second run see the first level's growth already applied (level one higher, stats grown), or the values from before the award?

**Affects.** The level-up row of the use table and the level-up handoff in [progression-and-levels.md](../spec/engine/progression-and-levels.md#stat-changes-on-level-up) and [actors.md](../spec/engine/actors.md#progression) (ACT-5); [BAT-8](../spec/engine/battle.md#bat-8) win reward order.

**Reawakened default now in force.** A non-empty legacy level-up program wins: the core hands off the actor id, the award and the target level and applies **no** default stat growth for that result. Facts round 11 (Q12) lists the order as program, then level and stats go up, then a message, which suggests growth does follow the program; the two have not been reconciled.

**If the answer differs.** If growth still follows the program, "program wins, no default growth" becomes a recorded Reawakened departure or is replaced; either way the owner decides it in a spec change before any level-up code changes.

### 4. Equip and remove programs: which entry paths, and "source left alone"

**Question for the TK-side engineer.** Which of these run an item's equip and remove programs: the `equip` and `remove` script commands, the menu's equipment screen, or both? Is it correct that the source slot is **not touched** for these two programs (so it holds whatever some earlier program left there), while the target slot is set to the wearer and restored afterwards? Is the order really: the equip program after the stat changes are applied, the remove program before the stat changes are reversed and before the item goes back to the inventory?

**Affects.** The equip/remove row of the use table; E-82 in [plugins-and-battle.md](../spec/engine/plugins-and-battle.md) (equip and remove program execution is left to the script layer); the `equip` and `remove` rows of `rpgcode-functions.md`.

**Reawakened default now in force.** E-82 rules the equip and remove operations and leaves the programs outside that contract. The proposed `callProgram` rule (pending owner review) runs them with the target set to the wearer and the source inherited from the calling thread, in the order round 12 states (fairly sure).

**If the answer differs.** Name the entry paths in E-82 and the order in the proposed rule; if the source slot is in fact set, say to what.

### 5. Battle special moves and items: which clauses of the order are certain

**Question for the TK-side engineer.** Round 12 gives the whole battle special-move and item flow as "fairly sure about the ordering", but round 11 (Q7) already gave the special-move order as certain. Please mark each clause certain or fairly sure: (a) the numeric effects are applied before the slots are set; (b) the slots are set before any animation plays; (c) the user's animation, then the move's animation, then the program; (d) the move's status effect is applied after the program; (e) an item is taken from the inventory before its program runs; (f) the item's program runs after the item's animation.

**Affects.** [BAT-5](../spec/engine/battle.md#bat-5): in particular whether the rebuild's posted consume effect may be applied before the item program runs.

**Reawakened default now in force.** BAT-5 (R11-Q7): a special move is effect, user animation, move animation, program, status effect, amounts; an item loses one copy through a posted consume effect and its program runs after its animation.

**If the answer differs.** Amend BAT-5's item order (and the slot timing in the proposed `callProgram` rule) clause by clause.

## Priority 2 — what a program sees, and what stays live

### 6. What the win, run, game-over, level-up, start-up, board-enter, key and link programs see

**Question for the TK-side engineer.** Round 12 says these programs "set nothing" and see "whatever the previous program or battle left in the slots", and the use table marks them "not set". In practice, what does a win program see right after an ordinary fight: the last acting fighter and its target, the last special-move or item pair, or nothing? What does a start-up program see on a fresh start, and on a start after a reset? What does the slot read as when it is "nothing" (does the script's source handle read as 0)?

**Affects.** The last row of the use table; [BAT-8](../spec/engine/battle.md#bat-8); THR-2 in [rpgcode-errors-and-threads.md](../spec/engine/rpgcode-errors-and-threads.md).

**Reawakened default now in force.** THR-2: a plain thread has `null` for both slots, and `sourceHandle()`/`targetHandle()` return 0 for `null`. The proposed `callProgram` rule (pending owner review) gives these programs `null`/`null` and records that as a departure from the stale values legacy shows.

**If the answer differs.** If a game could rely on the stale value (for example a win program reading the last enemy), say how; the departure then needs an owner decision.

### 7. Is a program started by the hand-over the outermost one?

**Question for the TK-side engineer.** A script command that starts another program ends the calling program first (round 12, point 9). When a program that is itself nested (started by a battle or the menu) uses that command, is the new program treated as nested or as the outermost for the message-window and screen rule of point 7? In other words, is the message window hidden and the screen captured again when the hand-over target starts, and hidden again when it ends?

**Affects.** The message-window and screen rule for the outermost program (an open item for the rendering owners, not ruled in the proposed `callProgram` rule); `run` in `rpgcode-functions.md`.

**Reawakened default now in force.** None. `run` hands over and ends the calling program (FUN-7, R2-Q20); nothing is ruled about the window.

**If the answer differs.** Hand the answer to the rendering owners as a new rule; it does not change `run` itself.

### 8. Does input stay live in every nested program?

**Question for the TK-side engineer.** Round 12 says the engine keeps handling input and window events between program steps. The earlier rounds say that `Delay` froze the window completely, while `Wait` and `Prompt` kept it responsive ([facts-round-6.md](facts-round-6.md) Q9; [facts-round-5.md](facts-round-5.md) Q4). Is there an exception inside a nested run: does a blocking command in a nested program freeze the window the same way, or does the live input of point 6 apply to every command in it? Does "drawing stay live" (the point's title) also mean the screen is repainted between steps, or only that input is read?

**Affects.** [Blocking commands (R-32)](../spec/engine/rpgcode-errors-and-threads.md#blocking-commands-r-32); [E-03](../spec/engine/main-loop-and-startup.md#e-03).

**Reawakened default now in force.** R-32: a blocking command stops all script execution, movement and frame updates until it finishes, and the host always repaints, so the window never freezes.

**If the answer differs.** Only the legacy-fact sentence in R-32 changes; the Reawakened rule already repaints in every case.

### 9. Which fields are checked for "empty" before a run

**Question for the TK-side engineer.** Round 12 says a blank program name does nothing and the caller carries on, and that "which fields are checked for emptiness before running varies by caller (see the table)", but the table has no such column. For each caller in the use table (enemy AI program, special-move program, item programs, status program, level-up, win, run, game-over, equip, remove, board item, start-up, board-enter, key, link), is a blank name skipped silently, and is a name that is set but names a missing file also silent, or does it report an error?

**Affects.** The missing and blank rows of the proposed `callProgram` rule; [BAT-6](../spec/engine/battle.md#bat-6) (the status program step) and [BAT-8](../spec/engine/battle.md#bat-8) (the win, run and game-over programs).

**Reawakened default now in force.** The proposed `callProgram` rule (pending owner review): a blank name does nothing; a missing file is a located `program.missing` diagnostic and does nothing.

**If the answer differs.** List the callers that differ; the proposed rule's table gets a column for it.

## Priority 3 — limits and other starters

### 10. Recursion or depth limit of nested runs

**Question for the TK-side engineer.** Round 12 says nesting works "to any depth". Is there a limit in the original (a fixed depth, a stack size at which a deep or endless self-starting chain fails), and what does the player see when it is reached?

**Affects.** The step-budget and depth note of the proposed `callProgram` rule (THR-3 in [rpgcode-errors-and-threads.md](../spec/engine/rpgcode-errors-and-threads.md)).

**Reawakened default now in force.** No depth limit is ruled. The proposed `callProgram` rule (pending owner review) counts the nested steps against the calling thread's budget and sets no depth limit.

**If the answer differs.** Rule a depth limit and its error code in the proposed rule.

### 11. Do sprite-triggered programs and the custom fight program nest the same way?

**Question for the TK-side engineer.** Round 12's use table has no row for a program triggered by a board sprite (earlier rounds: R2-Q24) or for the main file's custom fight program. Are they started as the same kind of blocking nested run, with the same slot behaviour (set for the duration, restored afterwards), or in a different way?

**Affects.** THR-2; [BAT-9](../spec/engine/battle.md#bat-9) (the custom fight program); [E-95](../spec/engine/plugins-and-battle.md#e-95).

**Reawakened default now in force.** THR-2: an entity event (including a sprite-triggered program and a fight) sets the pair on the thread that runs its program and restores the previous values when it ends. BAT-9: a main-file custom fight program replaces the package's battle loop.

**If the answer differs.** Add the two rows to the use table and amend THR-2.

### 12. What the player sees when two nested programs both use the message window

**Question for the TK-side engineer.** Round 12 lists this as not verified. If a nested program shows a message while the outer program already has one open, what does the player see: does the new text replace the old, append to it, or open over it? When the nested program ends, is the outer program's message still shown, cleared, or hidden? What is the visible effect of "the screen is captured" when the outermost program starts?

**Affects.** The message-window and screen rule for the outermost program (an open item for the rendering owners).

**Reawakened default now in force.** None for nested programs. The message-window rules in `rpgcode-functions.md` ([E-55](../spec/engine/rpgcode-functions.md#e-55)) describe one program.

**If the answer differs.** The rendering owners rule it; the proposed `callProgram` rule only points at it.
