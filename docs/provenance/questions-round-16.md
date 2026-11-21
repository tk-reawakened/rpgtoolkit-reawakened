<!-- Clean-room extraction round 16 (ADR 0006): question list. Answers landed in facts-round-16.md. -->

# Clean-room extraction, round 16 — key names visible to RPGCode scripts

* **Status:** answered and reviewed; see [facts-round-16.md](facts-round-16.md).
* **Date:** 2026-11-21 (approved by the project owner).
* **Why:** archive evidence (the ludotheque games and community code) shows only `"ENTER"` compared in games; it does not show what the engine returns for Escape or other keys.

**R16-Q1.** Which key-name strings can the legacy engine return from `Wait()`, `Get()` and `KeyDown()` (and any other command that reads a key name)? Give the full table: letters, digits, Enter, Escape, Space, arrows, numpad, function keys, punctuation, modifiers.

**R16-Q2.** Does the Escape key return any string to a script (e.g. `"ESC"`), or is it consumed by the engine and never reaches a script? Say when each applies (normal play, script-owned input wait, menus, battle).

**R16-Q3.** Are key-name comparisons and `KeyDown()` arguments case-sensitive? Does `KeyDown("enter")` match Enter?

**R16-Q4.** Does Enter return the same name from the main keyboard and the numpad?

**R16-Q5.** If several keys are pressed or queued, what do `Wait()` and `Get()` return and in what order; are queued keys flushed?
