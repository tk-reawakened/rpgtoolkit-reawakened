<!-- Clean-room extraction round: running a named program (ADR 0006). Review status: PARTLY REVIEWED. One independent agent checked the text for copied expression and for claims about the original authors' intent only (PASS WITH EDITS; four edits applied, listed under Status). No fact-checker compared any claim with the source, and no source revision ids were supplied. Certainty labels are the extractor's own. -->

# Clean-Room Extraction: Running a Named Program from the Engine

## Versions consulted
- Not supplied. No revision ids were given with this round, so [extraction-log.md](extraction-log.md) records them as not recorded.
- The extractor states that the shipped release and the final source behave the same for everything below. That statement is the extractor's and was not checked. The extractor also lists, under "Not verified from source" at the end, one place where the two versions may differ (the board-item path).

## Status
- **Relayed** by the owner on 2026-10-25, as the TK-side engineer's extractor answer to a question about how the engine runs a named program and whether that is one primitive (the text's Verdict answers "the stated premise"). The question text is not stored in the repository, and the answer names no session ids.
- **Reviewed once, for copied expression and intent only.** One independent agent read the staging text against the repository docs. It found no identifiers, file or function names, quoted error or message strings, or code-shaped structure. Verdict: **PASS WITH EDITS**. It did not read the legacy source and so could not check any fact. Four edits were applied, and nothing else in the text was changed (no fact, certainty label or meaning):
  1. Removed the remark in the "fresh state" point that loaded programs are cached for speed only (a description of the original's internal structure that the text itself said had no behavioural effect).
  2. Removed, from "Programs that set nothing", the claim that the stale values are almost certainly accidental, and the advice that a rebuild decide deliberately what these programs see (an unprovable claim about intent, and design advice). The factual first sentence stays.
  3. Removed, from the third "Not verified" item, the instructions not to copy the menu behaviour and to treat "the chosen player" as intended (instructions and a guess at intent). The extractor's own doubt ("may be wrong in legacy") stays.
  4. Removed, from the Verdict, the sentence recommending a single engine-level "run program with optional source and target" (a rebuild design recommendation). The "Yes. This is one core primitive" sentence stays.
- **Not fact-checked.** No agent compared any claim, any row of the table or any certainty label with the source. The extractor's original status line (that the text had not been through a copied-expression reviewer and a fact-checker at both revisions) is replaced by this section; the part of it that still holds is that the certainty labels are the extractor's own.
- **Items the reviewer could not judge without the source:**
  - whether points 1 to 9 follow the order of the original's run routine, especially points 7 and 8;
  - whether "captured" and "hidden again" in point 7 track the source, and what the visible effect of "the screen is captured" is;
  - whether "no per-ticket variants" in the Verdict refers to this repository's tickets (it came from the question) or to something in the source;
  - whether the legacy engine has a recursion or stack limit ("nesting works to any depth");
  - whether the table's row grouping mirrors a source switch;
  - every fact and every certainty label.
- **Ambiguities left in the text** (the text was not reworded to resolve them; the open ones are asked again in the round 13 question list, `questions-round-13.md`): which cells of the menu row apply to an item and which to a special move; which fields are checked for emptiness before a run (point 8 says "see the table", and the table has no such column); whether a program started by the hand-over of point 9 counts as outermost for point 7; which slot is restored in the "Restored afterwards?" column, and whether "n/a" means "stale" or "absent"; what "old values" means for a level-up, and whether built-in growth still follows a level-up program; whether the `equip` and `remove` commands, the menu, or both run those programs; whether point 6 has an exception for the blocking commands; which clause of the battle special and item flow is the uncertain one; and whether a recursion limit exists.

---

*The extractor's text follows, unchanged in wording. Only the layout is Markdown: headings, list markers and the table separator row were added.*

## Terms

- Nested run: the engine starts a named program, the program runs to its end, and only then does the code that started it continue.
- Source and target slots: two engine-wide values. Each holds "nothing", a player, an enemy or a board item. Programs read them to find out who is acting and who is being acted on.

## The general model (certain)

1. Blocking: a nested run is blocking and synchronous. The caller waits until the program finishes. There is no scheduling and no deferral. Nesting works to any depth because a program can itself start another.
2. No parameters: starting a program takes no source or target argument. The caller sets the two slots beforehand and the program reads whatever is there.
3. Fresh state each time: each run starts with its own local state, with nothing carried over from earlier runs. Global variables are shared with everything else.
4. Result discarded: a program can produce a final value, but every engine caller ignores it. The engine never branches on what a program returns.
5. Errors stay inside: an error in the nested program is reported and handled by that program's own error handling. It does not stop the caller, and the caller continues afterwards.
6. Input and drawing stay live: the engine keeps handling input and window events between program steps, so the game stays responsive while a program runs.
7. Message window and screen: the message window is hidden and the screen is captured only when the outermost program starts. A nested program does not reset these, and the message window is hidden again only when the outermost program ends. (Fairly sure about the exact hide/reset timing. Certain that nested runs skip it.)
8. Missing or blank program: nothing happens and the caller carries on. Which fields are checked for emptiness before running varies by caller (see the table). (Fairly sure.)
9. Script command that starts another program: the calling program is ended first, then the new one runs. The calling program never resumes. This is a hand-over, not a call-and-return. (Certain.)

## What the source and target slots hold at each use

| Use | Source | Target | Restored afterwards? | Certainty |
|---|---|---|---|---|
| Enemy custom AI turn | the acting enemy | a random living player, chosen by the engine | No | certain |
| Special move in battle | the user | the victim | No | certain |
| Item used in battle | the user | the recipient | No | certain |
| Status effect, each round | the afflicted fighter | the same fighter | No | certain |
| Item or special move used from the menu | the user (an item's source and target are both the player using it) | the chosen player | No | fairly sure |
| Equip and remove program | left alone | the wearer | Yes | certain |
| Board item activation | the item | the currently selected player | Yes | certain |
| Level-up, enemy win, enemy run, game over, startup, board-enter, key and link programs | not set | not set | n/a | certain |

- Battle special and item flow: the engine applies the numeric effects and sets the slots first. The battle system then plays its animations and runs the program. For a special move, the status effect is applied after the program finishes. For an item, the item is taken from the inventory before the program runs. (Fairly sure about the ordering.)
- Status effect timing: the status program runs once per round tick, not when the effect is applied. The remaining-round count drops after the program returns.
- Not restored: where the slots are not restored, the last value stays set after the program ends.
- Programs that set nothing: these see whatever the previous program or battle left in the slots.

## Timing and selection details

- Level-up: the program runs before the level number goes up, so it sees the old values. One experience grant that crosses several thresholds runs it once per level. (Certain.)
- Win and run programs: each enemy file may name one. When several enemies are present, the last one with a non-empty name is used, and only that one runs. The run program runs only when the player escapes. The win program runs after the experience and GP messages. (Certain.)
- Game over: when a battle is lost, the game-over program runs if one is set. Otherwise the player sees a short message and the game resets. The script command for game over behaves the same way and also ends the calling program. (Certain.)
- Enemy custom AI: if an enemy is flagged to use its own program, the program replaces the built-in AI choice for that turn. The engine picks the random target first. (Certain.)
- Equip program: it runs after the equipment stat changes are applied. The remove program runs before the stat changes are reversed and before the item returns to the inventory. (Fairly sure.)

## Verdict on the stated premise

Yes. This is one core primitive: a blocking nested run of a named program, with source and target supplied by the caller out of band. The legacy engine has no per-ticket variants.

## Not verified from source

- Whether the final source differs from 3.1.0 on the board-item path. I did not review that diff.
- Exact behaviour when two nested programs both touch the message window mid-run.
- What the menu path puts in the slots for a player target, which may be wrong in legacy.
