# Battle data: fight backgrounds, status effects, special moves

Three small files used by battles and the menu. All three have no version branches in their binary form; the editor writer and the engine reader agree field for field.

## Fight background (`.bkg`)

Lives in `Bkrounds\`. Referenced by boards (`battleBackground`) and scripts.

**Accepted `minor`: 2-3 (binary), 0 (text) — Reawakened rule.** The field list does not vary with binary `minor`, so it selects no layout: the 3.1.0 sample is `minor` 3 and the family's 2.x-era binaries are `minor` 2. A reader refuses binary `minor` 1 and 4-or-more and a negative version field rather than guessing; `minor` 0 is the Toolkit 2 line-oriented text form ([legacy/text-formats.md](legacy/text-formats.md#fight-background)), detected by non-zero at byte offset 12.

| # | Field | Type | Meaning |
|---|---|---|---|
| 1 | header | string | `RPGTLKIT BKG` |
| 2 | major, minor | short, short | the editor writes 2, 3; ignored |
| 3 | image | string | background image in `Bitmap\` (often a `.tbm`) |
| 4 | music | string | battle music in `Media\` |
| 5 | selectSound | string | menu cursor moved |
| 6 | chooseSound | string | menu item chosen |
| 7 | readySound | string | a fighter's charge bar is full |
| 8 | cantDoSound | string | action not possible |

Toolkit 2 text backgrounds: [legacy/text-formats.md](legacy/text-formats.md#fight-background).

<a id="status-effect"></a>
## Status effect (`.ste`)

Lives in `StatusE\`. Applied by special moves and scripts during battle.

**Accepted `minor`: 2-3 (binary), 0 (text) — Reawakened rule.** The field list does not vary with binary `minor`, so it selects no layout; the 2.x-era binary archive writes 2. A reader refuses binary `minor` 1 and 4-or-more and a negative version field rather than guessing; `minor` 0 is the Toolkit 2 line-oriented text form ([legacy/text-formats.md](legacy/text-formats.md#status-effect)), detected by non-zero at byte offset 16.

| # | Field | Type | Meaning |
|---|---|---|---|
| 1 | header | string | `RPGTLKIT STATUSE` |
| 2 | major, minor | short, short | the editor writes 2, 2; ignored |
| 3 | name | string | |
| 4 | rounds | short | how many rounds it lasts; decremented each round, removed at 0 |
| 5 | speed | short | non-zero = the fighter charges faster (charge rate +2 per tick while active) |
| 6 | slow | short | non-zero = the fighter charges slower (−2 per tick) |
| 7 | disable | short | non-zero = the fighter's charge is frozen (cannot act) |
| 8 | hp | short | non-zero = remove HP every round … |
| 9 | hpAmount | short | status HP amount (positive = damage, negative = healing) |
| 10 | smp | short | non-zero = remove SMP every round … |
| 11 | smpAmount | short | status SMP amount (positive removes SMP; negative restores it) |
| 12 | code | short | non-zero = run `prg` every round, with the affected fighter as both source and target |
| 13 | prg | string | program in `Prg\` |

**Reawakened stat clamp (BAT-5, BAT-6).** Status and special-move effects adjust actor HP and SMP; the actor owner clamps the resulting values at both bounds: HP to `0..maxHp` and SMP to `0..maxSmp`. The signed amounts stored in `.ste` and `.spc` files are not rewritten.

**Legacy status bounds (R11-Q5; owner-relayed, upper-cap claim fairly sure).** Legacy HP and SMP changes stop at 0 but have no upper cap, so negative amounts can heal or restore above maximum. This legacy behavior is distinct from the Reawakened clamp above.

Toolkit 2 text status effects: [legacy/text-formats.md](legacy/text-formats.md#status-effect).

## Special move (`.spc`)

Lives in `SpcMove\`. Learned by characters (see [character.md](character.md)) and used by enemies.

**Accepted `minor`: 2-3 (binary), 0 (text) — Reawakened rule.** The field list does not vary with binary `minor`, so it selects no layout: the 2.x-era binary archive writes 2 and the 3.1.0 family writes 3. A reader refuses binary `minor` 1 and 4-or-more and a negative version field rather than guessing; `minor` 0 is the Toolkit 2 line-oriented text form ([legacy/text-formats.md](legacy/text-formats.md#special-move)), detected by non-zero at byte offset 16.

| # | Field | Type | Meaning |
|---|---|---|---|
| 1 | header | string | `RPGTLKIT SPLMOVE` |
| 2 | major, minor | short, short | the editor writes 2, 2; ignored |
| 3 | name | string | |
| 4 | fp | int | FP removed from the target's HP (negative FP heals) |
| 5 | smp | int | SMP cost deducted from the user (the built-in enemy AI only picks a move it can afford) |
| 6 | prg | string | program run when the move is used |
| 7 | targetSmp | int | SMP amount deducted from the target |
| 8 | battle | byte | usable in battle: **0 = usable, 1 = not usable** (see note) |
| 9 | menu | byte | usable from the menu: **0 = usable, 1 = not usable** (see note) |
| 10 | statusEffect | string | `.ste` applied to the target |
| 11 | animation | string | `.anm` played when it is used |
| 12 | description | string | |

**Legacy special-move bounds (R11-Q7; certain).** The FP, target-SMP and user's SMP cost values are subtracted and stop at 0, but have no upper cap; negative values can raise HP or SMP above maximum. Reawakened results are clamped at both bounds as stated in [BAT-5](../engine/battle.md#bat-5).

**Compatibility note on fields 8-9:** the 3.1.0 editor's save writes 0 for usable and 1 for not usable, while its load displays the stored byte directly in the checkbox. A move saved as usable therefore reopens unticked. The engine passes raw values to plugins. The editor's load/save interaction after reopening was not verified; this note does not claim that opening a move flips the stored bytes.

**Ruled (Epic 7.1; owner-relayed [round 11](../../provenance/facts-round-11.md) Q15).** The stored byte is **0 for usable**: the default battle system lists a move in battle only when field 8 is 0, and the default menu allows a move only when field 9 is 0, and the editor's save agrees. The editor's load displays the stored byte in its checkbox without converting it back, so a move saved as usable reopens unticked. This resolves the on-disk meaning; whether opening and resaving a move changes the stored byte remains unverified. The built-in enemy AI ignores these flags.

Toolkit 2 text special moves: [legacy/text-formats.md](legacy/text-formats.md#special-move).

<a id="battle-data-editor-rules"></a>
## Editing special moves and status effects (Reawakened rules; story 13.10)

The Reawakened editor opens `.spc` and `.ste` files for editing under these rules. They state what the editor does with the stored values above; they do not change a stored layout, and they claim nothing about behaviour this page and [BAT-5](../engine/battle.md#bat-5) / [BAT-6](../engine/battle.md#bat-6) do not already state (for example, what a status with fewer than 1 round does belongs to BAT-6, not to the editor).

1. **Same-version writing.** A file of accepted binary `minor` 2-3 is written back at the `minor` it was read at. Bytes after the last documented field and the `major` and `minor` values are kept. Opening and saving with no edit leaves the file byte for byte unchanged. A Toolkit 2 text file (`minor` 0) opens read-only with the reason; it is never converted on open, and no edit is accepted for it.
2. **Usability flags (special move fields 8 and 9).** The editor shows a move as usable in battle (or from the menu) exactly when the stored byte is 0, per the ruling above, and writes 0 for usable and 1 for not usable. It does not reproduce the 3.1.0 editor's checkbox, which displays the stored byte without converting it. A flag the author does not touch keeps its stored byte, including `-1` or any other non-zero value. Choosing "usable" for a non-zero byte writes 0. Choosing "not usable" for a byte that is already non-zero changes nothing.
3. **Status flags (status effect fields 5-8, 10 and 12).** A flag is on exactly when its stored value is non-zero. Turning one on writes 1 when it was 0; turning one off writes 0. Turning on a flag that is already non-zero changes nothing, so an authored `-1` or `7` survives. The amounts stay stored whether or not their flag is on.
4. **Signed values.** The special move's FP, user SMP cost and target SMP amount are signed 32-bit integers, and the status effect's rounds, HP amount and SMP amount are signed 16-bit integers; a negative FP, HP amount or SMP amount heals or restores. The editor stores the integer the author enters, refuses a value outside the field's range or a non-integer whole, and never clamps or rewrites it (the stat clamp is the actor owner's, BAT-5).
5. **References.** A special move's status effect, animation and program, and a status effect's program, are stored as the text the author enters or picks, under [the path rules](README.md#paths-inside-files). A reference to a file that is not in the project is kept and reported; it is never cleared or rewritten. Text the file's code page cannot store is refused whole.

<a id="battle-background-editor-rules"></a>
## Editing fight backgrounds (Reawakened rules; story 13.11)

The editor lets an author choose a battle's background picture, music and four distinct menu sounds. Choosing a file and listening to it are separate: previewing a sound never changes the stored reference.

1. **Same-version writing.** Binary `minor` 2–3 files keep their `major`, `minor` and bytes after the last documented field when edited. Opening and saving without an edit leaves the bytes unchanged. A Toolkit 2 text background opens read-only, with the reason; it is never silently converted.
2. **References.** The image is a project bitmap reference; music and all four sounds are project media references. The editor stores the text entered or selected under [the path rules](README.md#paths-inside-files). It retains and reports missing or ambiguous references rather than clearing or rewriting them. Unrepresentable text is refused whole.
3. **Audition.** Where the host offers audio output, authors can play and stop a supported sound and choose whether it loops. Missing files, unsupported formats and unavailable host output are reported without changing the reference. Audition is not proof of playback in a battle.
4. **Battle picture.** A binary background's image is resolved as a bitmap and loaded for the battle picture, including a tile bitmap where supported. Text backgrounds retain their tile-and-tint grid behavior.

## Examples

[../examples/listings/fireball.spc.txt](../examples/listings/fireball.spc.txt), [../examples/listings/burn.ste.txt](../examples/listings/burn.ste.txt), [../examples/listings/forest.bkg.txt](../examples/listings/forest.bkg.txt).
