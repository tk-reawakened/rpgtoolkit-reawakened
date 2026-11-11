# The catalogue of document kinds

Part of the [editor ecosystem proposal](README.md). Groups 1 and 2 restate what other records already decide or plan. Groups 3 to 5 are **proposals**: a row there is a candidate, not a commitment, and reserves no extension (ADR 0023 decision 11: none is reserved in advance).

## In plain terms

There are five groups of thing the editor should be able to open:

1. the Toolkit 3 files, edited in place;
2. native documents that are already decided or being specified;
3. new native documents that would hold what Toolkit 3 files cannot;
4. files from other tools, which are looked at and imported;
5. things that are views over other documents and need no file of their own.

The last group matters as much as the third. Not every new editor needs a new file type.

## Admission test for a new kind

A candidate becomes a contract page only when it can answer all six. The page records the answers.

| # | Question | Why it is asked |
|---|---|---|
| 1 | **Whose task is this?** Name the creator situation and the outcome wanted. | [Experience bank](../editor-experience-bank.md): editors start from intent, not from storage. |
| 2 | **Why can no existing document hold it?** Show what is lost or hidden if it goes into a legacy file, a `.prg` or a plugin block. | ADR 0005 decision 3: a native format when legacy limits a feature. [Block or document](../spec/formats/native-contracts.md#block-or-document) for plugin data. |
| 3 | **How does the game use it?** One of: the editor lowers it to files the engine already plays; the engine reads it (which needs its own ADR and goldens); or it is editor-only. | ADR 0019 decisions 3 and 7; G5. |
| 4 | **What does a change look like in Git?** One thing per document, a stable identity, no numbered slots. | ADR 0023; [notation findings](../findings/native-data-notations/README.md). |
| 5 | **What refers to it and what does it refer to?** | The project index and safe rename need the answer. |
| 6 | **Which editor does it get first?** A form, a Database list, or a specialist view, and which story builds it. | "Build only what a real caller needs." |

## 1. Toolkit 3 kinds, edited in place

First-class editable for the first release (ADR 0005 amendment). All are legacy binary except programs. The formats are specified under [spec/formats](../spec/formats/README.md).

| Kind | Files | Editor | Planned in |
|---|---|---|---|
| Main game file | `.gam` | Project and game settings | 11.2, 11.6 |
| Board | `.brd` | Board editor | 12.1, 12.3, 12.10, 12.11 |
| Program | `.prg`, `*.spec.prg` | Code editor; later visual events | 11.7, 11.9, 14.2 |
| Character | `.tem` | Character editor | 12.5 |
| Item | `.itm` | Item editor | 12.6 |
| Enemy | `.ene` | Enemy editor | 13.9 |
| Special move, status effect | `.spc`, `.ste` | Move and effect editors | 13.10 |
| Battle background | `.bkg` | Background editor | 13.11 |
| Animation | `.anm` | Animation editor | 12.7 |
| Tile bitmap | `.tbm` | Stamp editor | 12.8 |
| Tileset, animated tile | `.tst`, `.iso`, `.tan` | Tileset browser, tile tools | 12.2, 13.3 to 13.6 |

A file with no same-version writer (a pre-vector board, a compiled program) registers as the same kind, opened read-only with its reason (ADR 0022 D2.1).

## 2. Native kinds already decided or in flight

| Kind | Extension | Record | State | How the game uses it |
|---|---|---|---|---|
| Animation clip | `.tkranm` | [native-animation-clip.md](../spec/formats/native-animation-clip.md), ADR 0023 | Pre-release; reader, writer and importer exist | To be ruled with the contract |
| Scene | `.tkrscn` | [tkr-authoring.md](../spec/formats/tkr-authoring.md), ADR 0019 | Specified; no code | Lowered to `.brd` |
| Tile recipes | `.tkrtile` | same | Specified; no code | Lowered to `.tst`, `.iso`, `.tbm` |
| Scene asset pack | `.tkrpack` | same | Specified; no code | Expanded into the scene's board |
| Actor family; scene placements | none yet | Stories 27.7, 27.8 | Not written | Not ruled |
| Item, enemy, tileset | none yet | native-contracts.md registry note | Not written | Not ruled |

All of these are deferred for the first release. The naming difference between the ADR 0019 trio and the ADR 0023 rule is [decision 2 of the roadmap](roadmap.md#decisions-asked-of-the-owner).

## 3. Candidate new kinds

Each row names the need and what Toolkit 3 does today. "First editor" is the cheapest useful one. Order within the table is the suggested order of work.

| Candidate | The need, in the author's words | Toolkit 3 today | How the game would use it | First editor | Seen in |
|---|---|---|---|---|---|
| **Project definition** | "Make a game without opening a settings screen; change the keys or the screen size when I need to." | The main file: 61 layout rows, fixed-size tables, an inverted flag, stored outside the project folder ([study](../../_bmad-output/initiative-rpgtoolkit-reawakened/research-editor-ux-for-beginners/flows/08-project-file-by-convention.md)) | Lowered to `.gam` | Form, with effective value and its source | Godot's `project.godot` |
| **Data table** | "My game has elements, classes and weapon types, and I want to pick them from a list everywhere." | Free text repeated in each file; names of accessory slots per character | Editor-only at first: it feeds choices to forms. Read by scripts only after a ruling | Database list with a row editor | RPG Maker's Types and Terms |
| **Screen layout** | "Redesign my menu, my battle screen, my title screen, by dragging things." | Drawn by plugin code; a skin is two images (T-64) | Read by the menu or battle subsystem that owns the screen; needs that subsystem's contract | Specialist canvas with the form as inspector | Godot's control scenes |
| **Encounter group** | "These three enemies appear together in the forest." | An enemy pool in the main file plus per-board battle settings | Lowered to the main file's pool and board settings, where they can hold it | Database list | RPG Maker's Troops |
| **String table** | "Translate my game; fix a typo without hunting through programs." | None; text lives in programs | Needs an engine ruling; not lowerable | Table view | Godot's translation files |
| **Test scenario** | "Start here, with this party, press these keys, and check what happens." | None | A fixture and action list for creator tests; representation is ruled in 14.1 | Form, then the visual builder of 14.7 | None of the three |
| **Recorded session** | "Here is exactly what I did when it broke." | None | The engine's own input log (AD-14), kept as a file | Read-only viewer with replay | None of the three |
| **Sound set** | "These are my game's sounds and what each is for." | File names typed into each field | Editor-only grouping at first | Database list with audition (14.5) | Godot's audio buses, loosely |
| **Timeline** | "A cutscene: walk here, say this, fade, at these times." | Written as a program | Lowered to RPGCode, if a safe lowering can be ruled; otherwise not pursued | Specialist view | Godot's animation player |

Notes on the table:

* **Project definition comes first** for three reasons. ADR 0024 lists it as an unwritten contract that per-project plugin configuration needs. It is the natural home of the list of installed contributions. And every author meets it.
* **Data tables come second** because the form's "choice" control needs somewhere to get its choices that is not hard-coded.
* **Screen layout is the largest** and depends on the menu and battle subsystems publishing what a screen can bind to. The plugin-editor study treats it as the model case for a specialist panel.
* The last four are listed so the mechanism is tested against them, not because they are near.

## 4. Files from other tools

Outside assets are opened in a viewer, referenced by other documents, and may be the source of an [import](architecture.md#import). Nothing here is edited in place.

| File | Use | State |
|---|---|---|
| PNG, JPEG, GIF, BMP | Pictures, sheets, sources for the tile grabber | Engine decoders exist (AD-28); editors planned (13.3, 13.4) |
| WAV, MIDI and the audio set of the engine's format policy | Music and sound | Engine seam decided (AD-31 audio rule); audition 14.5; conversion 14.11 to 14.14 |
| Fonts | Text | Engine-owned text (AD-15); no editor planned |
| Tiled maps and tilesets; LDtk levels | Bring in a map made elsewhere as a scene | Named by AD-31 as the reason for the decoder interface; no importer planned. Each needs a reader that passes G6 or is written here from the public format description |
| Aseprite files and sprite sheets | Bring in frames as animation clips | No importer planned |
| Sheets laid out for another tool's conventions | Bring in character or tile sheets by a known grid | Layout conventions only. Another product's bundled art is not ours to redistribute, and the importer must say so |
| A Toolkit 2 or 3 project | Open an old game | Covered by the legacy format epics; not part of this proposal |

## 5. Views that need no file of their own

| View | Over | Why it is not a kind |
|---|---|---|
| World map | The links between boards (T-27) | It is drawn from the boards; saving it would make a second source of truth |
| Conversation view | A program | ADR 0022 D2.3: a visual view of text edits the text. Whether a subset of RPGCode can be shown this way is 14.1's ruling |
| Visual events | A program | Same |
| Variable and switch list | The RPGCode index | Derived |
| Problems | The index | Derived |
| Save file viewer | A save game ([save-game.md](../spec/formats/save-game.md)) | A read-only kind for finding faults; registered so it opens, never edited |
| Package viewer | A distribution package and its manifest | Read-only; used by the delivery check of 12.9 |

## What a contract page must contain

For a kind in group 3 that passes the admission test, the page in `docs/spec/formats/` follows the animation clip page: the six answers, the stamp and core fields, the schema, the identity and reference rules, the lowering rule or the statement that there is none, what the checker reports, a worked example, and the list of what is not decided. The kind's extension and registry row are added in the same change as the page, never before.
