# The Toolkit 3.1 editors, and what each becomes

Part of the [editor ecosystem proposal](README.md). **Proposed.** This is the starting point of the whole proposal: the editors RPG Toolkit 3.1 shipped, taken one at a time.

## Where the facts come from

Everything about the 3.1 editors on this page comes from [editor-features.md](../editor-features.md) (the T-xx inventory) and [spec/formats](../spec/formats/README.md). The legacy source tree was **not** opened to write it. Under [ADR 0006](../adr/0006-clean-room-spec-extraction.md) the assistant that writes tickets, documents and code never reads that source; a gap in the inventory is closed by a written question list and a separate extraction round, never by looking it up. If a 3.1 editor or behaviour is missing from the table below, that is a gap in `editor-features.md` to raise as a question.

## In plain terms

The 3.1 editor was a set of about twenty tools, each built around one file type and each built by hand. Every tool had its own window, its own form and its own idea of undo. Most limits an author met were limits of the file, not of the tool: a fixed number of slots, a name typed as text where a choice was meant, a setting stored in the wrong file.

For each tool this page says three things: what it edited, what held it back, and what it becomes here. "Becomes" always has two parts. The **first release** keeps the tool and its file, because Toolkit 3 files stay first-class editable. **Beyond** is what the same editor can do once it is written against a contract and not against the file ([architecture](architecture.md#one-contract-more-than-one-kind)).

## Editor by editor

"What held it back" is read from the inventory, the format pages and the editor research. Where it says a tool lacked something, the evidence is that the inventory records none, which is not proof that 3.1 had none.

| 3.1 editor | Features | File | What held it back | First release | Beyond the Toolkit 3 file |
|---|---|---|---|---|---|
| **Main file editor** | T-10 to T-14 | `.gam` | Five tabs of settings; fixed tables (50 key slots, an enemy pool); a flag stored inverted; kept outside the project folder | Game settings, edited in the `.gam` (11.6) | A **project definition**: conventions first, effective value and its source shown, plugins and contributions listed in one place |
| **Board editor** | T-20 to T-35 | `.brd` | No stable identity for a floor or an object; a pasted building forgets it was one thing; walls are redrawn by hand; one undo model of its own | The scene editor, opening and saving `.brd` directly; and, in the first release, saving a **scene** | A **scene**: named floors, stable object identities, placed packs that stay packs, traced boundaries (ADR 0019). Imports from Tiled and LDtk land here |
| **Tile editor** | T-36 | tile in a `.tst` | 32 by 32 only; single undo; effects are destructive | Pixel editor (13.3) | **Tile recipes**: the steps that made a tile are kept and can be changed (ADR 0019) |
| **Tile grabber** | T-37 | image to `.tst` | One-shot: the grid and choices are lost after the grab | Reviewed extraction (13.4) | An **import with a saved recipe** that can be run again when the picture changes |
| **Tileset editor** | T-38 | `.tst`, `.iso` | Reordering breaks every board that uses the set, with only a warning | Curation (13.5) | Tiles referred to by identity, so reordering is safe; the project index shows every use first |
| **Animated tile editor** | T-39 | `.tan` | A separate small tool for one idea | Animated tiles (13.6) | Folded into tile recipes and the animation clip contract |
| **Auto-tiler** | T-25 | a tileset in a fixed order | Depends on one fixed variant ordering | Neighbour-aware tiling (13.7, 13.8) | Terrain rules as data in a tile recipe |
| **Program editor** | T-40 to T-44, T-46 | `.prg` | Colouring, bookmarks and call tips; the inventory records no finding of uses and no checking before a run | Monaco or VS Code with language services (11.7) | Creator tests, a debugger, and plugin commands documented in the same reference |
| **Visual event builder** | T-45 | builds a `.prg` | Builds code from forms; the inventory records no way back from code to forms; a fixed list of about 160 templates | Structured events over the program text (14.2, 14.3) | Plugin commands appear in the palette from their descriptions ([level 0](extensions.md#three-levels)) |
| **Character editor** | T-50, T-51, T-53, T-54 | `.tem` | Up to 200 moves, 10 accessory slots, stat names bound to script variables by text | Character editor (12.5) | The **actor** contracts (27.7); slots and stat lists come from **data tables**; a battle system adds its own fields |
| **Sprite graphics editor** | T-52 | inside `.tem` and `.itm` | Shared by copy between two file types; one collision shape per sprite | Shared stances and bases (12.4) | One contract for "how a thing looks and where it stands", used by every actor |
| **Item editor** | T-55 | `.itm` | One file means both "a thing in a bag" and "a thing standing on a board" | Item editor (12.6) | Split by ADR 0023 decision 9 into the contracts the research supports |
| **Enemy editor** | T-56 | `.ene` | Fields mean what the chosen battle plugin says they mean, and the editor cannot know | Enemy editor (13.9) | Stock fields plus the battle system's own, shown as one form ([level 1](extensions.md#three-levels)) |
| **Special move and status effect editors** | T-57, T-58 | `.spc`, `.ste` | Small forms with no view of what uses them | Move and effect editors (13.10) | One **Database view** with "used by" from the project index |
| **Animation editor and wizard** | T-60, T-61 | `.anm` | One delay for all frames; the wizard's choices are not kept | Animation editor (12.7) | The **animation clip** contract (`.tkranm`); imports from sprite sheets and Aseprite |
| **Tile bitmap editor** | T-62 | `.tbm` | A stamp with no collision or walk-behind of its own | Stamp editor (12.8) | A **scene asset pack**: a stamp that carries its collision and layering (ADR 0019) |
| **Background editor** | T-63 | `.bkg` | A picture, music and four sounds, tied to one battle screen | Background editor (13.11) | Part of a **screen layout** for the battle screen |
| **Skin editor** | T-64 | two images | Two graphics; everything else is drawn by plugin code | Skins (14.4) | **Screen layouts** for menus, battles and titles |
| **Make package, Pak compiler, setup** | T-70 to T-72 | `.tpk`, setup | Three tools for one job | Package and setup (12.9, 14.6) | One delivery view; a read-only package viewer |
| **The Bard** | T-80 | audio files | A separate player, outside the editor | Audition (14.5) | Audition inside every sound picker; a **sound set** |
| **Workspace, file tree, new project, preferences, help** | T-01 to T-09 | none | Buttons that were hard to find; settings spread over tools | Epic 11 | Game and Files views over one project; the Database; search over everything |

## What the 3.1 set never had

These are not gaps in a 3.1 tool. No 3.1 file could hold them, so no tool existed. They are the [candidate kinds](document-kinds.md#3-candidate-new-kinds) and shared tools of this proposal.

| Missing in 3.1 | Proposed here |
|---|---|
| One place that lists every character, item, enemy, move and effect | The Database view |
| "What uses this?" and a rename that is safe | The project index |
| Lists of choices the author defines once (elements, classes, weapon types) | Data tables |
| Encounters as named groups | Encounter groups |
| A menu or battle screen designed by eye | Screen layouts |
| Text kept apart from programs, for translation | String tables |
| Tests an author can write and keep | Creator tests (TOOL-5) and test scenarios |
| Bringing in a map, sheet or sound made in another tool, more than once | Import with a saved recipe |
| A plugin that adds its own fields and screens to the editor | Contributions |
| The same editor in a browser and in VS Code | One `editor-ui`, three hosts |

## What is dropped

T-81 (the built-in web browser) is obsolete and is not rebuilt. T-73 (the 2.x folder upgrade) stays outside the editor epics, as the [delivery plan](../../_bmad-output/initiative-rpgtoolkit-reawakened/ux-connected-editors/editor-delivery-plan.md) records. Nothing else from the 3.1 set is dropped by this proposal.
