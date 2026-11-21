<!-- Clean-room extraction round 16 (ADR 0006): reviewed extractor facts. Facts are not rulings; specification changes follow separately (G7). -->

- **Source consulted:** the extractor read the legacy engine source (revision 62cf0f01, 2026-11-01); nothing was run.
- **Questions:** [questions-round-16.md](questions-round-16.md), R16-Q1 to R16-Q5, owner-approved 2026-11-21.
- **Review:** a reviewer subagent that had not seen the extractor's transcript returned PASS WITH EDITS twice; every finding was applied.
- **Open:** whether a script comparison such as `key == "enter"` is case-sensitive (R16-Q3) was not established.

# Clean-room extraction, round 16 — key names visible to RPGCode

Version note: the final source contains two runtimes. The newer one (the native rewrite that shipped as 3.1.x) is the main basis for these answers. The older 3.0.x-era runtime is noted where it differs. Released 3.1.0 is assumed to match the final source for the newer runtime (probable). I did not diff it against a tagged 3.1.0 build.

## R16-Q1 — Key-name strings returned to scripts

Script commands that return a key name:
- `Wait()` blocks until a key arrives.
- `Get()` does not block and returns an empty string `""` if the key queue is empty.

Both commands use the same name translation. In the newer runtime, RPGCode has no command that reports whether a key is held right now; that check exists only for plugins (see Q3). `MouseClick` returns coordinates, not key names.

How a key press becomes a name (newer runtime):
1. On each key-down event, the engine asks Windows to translate the key into a character, using the current keyboard layout and the Shift, Ctrl and Caps Lock state.
2. If that translation fails, the engine keeps the raw virtual-key code instead.
3. Either way, the value is stored as a single byte.
4. When a script reads the key, six byte values get special names. Every other byte becomes a one-character string, converted to upper case.
5. Shift on its own is never queued (certain): the key-down handler ignores it, so pressing Shift alone produces no key and `Wait()` keeps waiting. Shift only affects the character produced by other keys.

| Byte value | Name returned |
|---|---|
| 13 | `ENTER` |
| 27 | `ESC` |
| 37 | `LEFT` |
| 38 | `UP` |
| 39 | `RIGHT` |
| 40 | `DOWN` |
| anything else | that one character, upper-cased |

What each kind of key produces:
- **Letters** come back as upper-case single letters `A`–`Z`, whether or not Shift is held. Both commands request upper case. (certain from the mapping; probable for real-world behaviour)
- **Digits on the main row** come back as `0`–`9`. With Shift, the layout's shifted symbol is returned instead, e.g. `!` or `@`. (certain from the mapping; probable for real-world behaviour)
- **Space** comes back as a single space character `" "`, not the word `SPACE`. (certain from the mapping; probable for real-world behaviour)
- **Enter** (main key) comes back as `ENTER`. (certain from the mapping; probable for real-world behaviour)
- **Escape** comes back as `ESC`. (certain from the mapping; probable for real-world behaviour)
- **Tab** comes back as the tab character (byte 9). (certain from the mapping; probable for real-world behaviour)
- **Backspace** comes back as the backspace control character (byte 8). (certain from the mapping; probable for real-world behaviour)
- **Arrow keys** come back as `LEFT`, `RIGHT`, `UP` and `DOWN`. They have no character translation, so their raw virtual-key codes 37–40 are used. (certain from the mapping; probable for real-world behaviour)
- **Punctuation** comes back as the layout's character, upper-cased. Upper-casing has no effect on symbols. (certain from the mapping; probable for real-world behaviour)
  - Quirk (certain from the mapping): four ASCII punctuation characters share byte values with the arrow codes. `%` (37) returns `LEFT`, `&` (38) returns `UP`, `'` (39) returns `RIGHT` and `(` (40) returns `DOWN`. On a US layout, Shift+5, Shift+7, the apostrophe key and Shift+9 are reported as arrows.
- **Numpad with Num Lock on**: digit keys return `0`–`9`. The `*`, `+`, `-`, `.` and `/` keys return those characters. Numpad Enter returns `ENTER`. (probable, newer runtime; this depends on how Windows translates numpad keys)
- **Numpad with Num Lock off**: the keys act as navigation keys. Translation fails and the raw virtual-key code is stored, so the result is a stray character. Home (36) gives `$`, End (35) gives `#`, PgUp (33) gives `!`, PgDn (34) gives `"`, Insert (45) gives `-` and Delete (46) gives `.`. Numpad 4, 8, 6 and 2 act as arrows and return `LEFT`, `UP`, `RIGHT` and `DOWN`. The same applies to the dedicated navigation cluster. (probable)
- **Function keys F1–F12**: translation fails, so the raw virtual-key codes 112–123 are stored. Those are the letters `p` through `{`, so after upper-casing F1–F11 return `P` through `Z`, and F12 returns `{`. There are no `F1`-style names. (certain from the mapping; probable for real-world behaviour)
- **Modifiers**:
  - Ctrl (17) and Alt (18; usually delivered as a system key, so possibly never queued) are not translatable, so the raw code is kept and produces an invisible control character. (probable)
  - Ctrl+letter produces control characters 1–26. (probable)
- **Shift+letter** still returns the upper-case letter, so `Wait()` cannot tell `a` from `A`.

Older 3.0.x runtime (differences; probable):
- Keys were queued as raw key codes, not translated characters. Names were `ENTER`, `UP`, `DOWN`, `LEFT` and `RIGHT`; everything else became the code's character.
- Letters therefore came back upper case.
- Older bug: in that runtime's read function, codes 37 and 39 were swapped, so the Left arrow returned `RIGHT` and the Right arrow returned `LEFT`. The name passed to plugins was correct.
- Joystick buttons could also be returned: `BUTTON` for the first button and `BUTTON2` onward for the others.
- That read path had no special name for Escape (it came back as byte 27). The plugin notification path did use `ESC`.

## R16-Q2 — Escape

- **Normal play, newer runtime (certain).** The engine has no built-in Escape action. Escape is queued like any other key and is reported to plugins as `ESC`. The menu key is a separate, project-configured key; Escape opens the menu only if the project chose it as the menu key. Queued Escape presses remain in the key queue, and a later `Get()` returns them as `ESC` unless something has cleared the queue first.
- **During a script's `Wait()`/`Get()` (certain from the mapping; probable for real-world behaviour).** Escape reaches the script as the string `ESC`.
- **Engine-owned waits.**
  - The built-in shop treats `ESC` as "leave".
  - One built-in message/choice box treats `ESC` as "cancel".
  - In both cases the engine consumes the key; the script never sees it.
  - The simple message box closes on any key except the arrows, including Escape. (certain)
- **Menus and battle.** These are run by plugins, which receive the key event with the name `ESC`. Whether a plugin consumes Escape depends on that plugin and is not determinable from the engine core. The engine does not filter Escape before plugins see it. (not determinable for specific plugins)
- **Older 3.0.x runtime (probable).** Escape was also queued. As the bare byte 27 it was not translated to `ESC` on the script path. The only built-in special key in normal play was Alt+X (forced quit).

## R16-Q3 — Case sensitivity

- **Values returned by `Wait()`/`Get()` (certain).** These are always upper case, and the names are upper-case words.
- **Script string comparison.** Whether a script comparison such as `key == "enter"` matches the returned `ENTER` depends on the script language's string comparison rule. I did not establish that rule, so it is **not determinable** from this round's scope. Note that the returned name is always upper case.
- **The named-key "is held" check (plugin-facing in the newer runtime; also present in the older runtime) (certain).**
  - The argument is upper-cased before matching, so `enter`, `Enter` and `ENTER` all match the Enter key.
  - Accepted names: `LEFT`, `RIGHT`, `UP`, `DOWN`, `SPACE`, `ESC` or `ESCAPE`, `ENTER`, and `NUMPAD0`–`NUMPAD9`.
  - Any other argument is checked using its first character's code as a key code. In practice this works for letters and digits; for example, `a` is upper-cased to `A`, which tests the A key.
  - This list differs from the read path: it accepts `SPACE` and `ESCAPE`, which `Wait()`/`Get()` never return.

## R16-Q4 — Main Enter vs numpad Enter

- Both keys arrive with the same Return code and translate to the carriage-return character, so both return `ENTER`.
- The engine has no way to tell them apart, and nothing in the engine reads the extended-key flag.
- The held-key check also tests the same Return key code for both.
- Certainty: probable for the newer runtime (the same label as Q1); probable for the older one.

## R16-Q5 — Several keys, ordering and flushing

- **Order (certain).** Every key-down event, including auto-repeat while a key is held, is added to the back of one first-in-first-out queue. Reads take from the front, oldest first, one key per call.
- **`Wait()` (certain).**
  - It first empties the queue, so keys pressed before the call are discarded.
  - It then processes window messages until at least one new key arrives, and returns the oldest of those keys.
  - If two keys arrive before `Wait()` checks the queue, the first one is returned and the second stays queued for a later `Get()`.
- **`Get()` (certain).**
  - It returns the oldest queued key without waiting, or `""` if the queue is empty.
  - It does not flush the queue.
  - It does not pump messages itself, so a key appears only after the engine has processed events elsewhere.
- **Explicit flush (certain).** A separate RPGCode command clears the queue. The older runtime had its own routine that cleared its queue.
- **Normal-play scanning.** Movement and the activation, menu and run-time keys are polled from the live keyboard state, not from this queue. While a game is played, keys therefore pile up in the queue until `Wait()` flushes it or some other command reads or clears it. (certain)
- **Engine dialogs.** The built-in message boxes and the shop use the same wait routine, so they also flush the queue before waiting. (certain)
- **Simultaneous holds.** For keys held down together, only the most recent key auto-repeats in Windows, so the most recent key dominates the queue after the initial presses. (probable; this is operating-system behaviour)
- **Older 3.0.x runtime (probable).** It used the same queue model, with its own queue and its own routine that cleared that queue.
