---
type: discovery
title: "Reconciling docs/spec with format-spec, engine-features, the epics and the code"
date: 2026-10-15
baseline_revision: 479e460
---

# Reconciling `docs/spec/` with the specs, the epics and the code

Commit 479e460 added `docs/spec/`: a byte-level and behavioural specification of Toolkit 3.1, with Python reference readers (`docs/spec/tools/`), a complete example game and one example file for every version of every format (`docs/spec/examples/`). This report compares it with `docs/format-spec.md`, `docs/engine-features.md`, the code in `packages/` and the epics. Each finding has an ID (**R-nn**); the epic entries cite them.

## Owner decisions (Jensen, 2026-10-15)

1. **`docs/spec/` replaces `docs/format-spec.md` and `docs/engine-features.md`** as the normative specification. `docs/editor-features.md` (T-xx) is not replaced.
2. **Provenance:** the owner attests `docs/spec/` is clean and may be used as-is. Recorded as round 4 of `docs/provenance/extraction-log.md` (commit a666890).
3. **Placement:** each change goes to the epic that owns its area. Epics not yet started get Notes for their inception.

### What "replaces" means in practice (proposed for ADR 0007, entry 1.13)

- `docs/spec/` describes what Toolkit 3.1 does. Where Reawakened deliberately differs or adds rules (determinism, limits, our own package format, owner rulings), the rule moves into `docs/spec/` as a marked **Reawakened rule** block next to the legacy behaviour it changes. That way one page holds both, and an implementer can tell which is which.
- **Real files beat prose.** Where the archive corpus contradicts a `docs/spec/` statement (R-17, R-18), the page is corrected and cites the files. `docs/spec/` itself says its legacy layouts were "documented from the original programs' reading logic only; no Toolkit 1-2 sample files were available".
- Stable IDs survive the move: E-xx labels go onto the `docs/spec/engine/` pages, and citations use `docs/spec/<path>#<anchor>`. This keeps the epics, plans and about 940 code citations re-pointable mechanically.
- `format-spec.md` and `engine-features.md` stay as redirect stubs until every citation is re-pointed (entry 3.28), then are deleted.

## How this was checked

| Check | Result |
|---|---|
| Our dump over the 3.1 sample corpus (`pnpm dump:check`) | Basic 16 and demo 30 files parse, all digests match |
| `docs/spec/tools/rpgtk_formats.py verify` over the same corpus | 27 + 13 binary files parse exactly to end of file, 0 mismatches. **Both readers agree on every real 3.1 file.** |
| Our dump over `docs/spec/examples/game` | 17 parsed, 0 failed, 9 skipped (no reader: `.tbm` ×2, `.tan`, `.gph`, `.sav`, `.prg` ×4) |
| Our dump over `docs/spec/examples/versions` | 43 parsed, 12 failed: every Toolkit 1/2 text form (expected; tk2-support 16.4/16.5) and `main_tk1.gam`. Character minors 3 and 4 parse with **326 residue bytes** (tk2-support 16.6) |
| Our package loader over `examples/files/example_game.tpk` and `standalone_layout.exe.bin` | Both load to the same 17 files as the folder. These are the repo's first real `.tpk` and `CMP1` EXE |
| Our VGA palette (`core/formats/tileset/vga-palette.ts`) against `docs/spec/formats/dos-palette.json` | **236 of 256 entries differ** (R-01) |
| Our command catalogue (271 names + language-level) against `docs/spec/engine/rpgcode-functions.md` (282) | 8 names missing from ours (R-36) |

The new spec's Python tools need only the standard library, plus Pillow for renders. They are useful as an independent second reader, but they are not part of any build.

## A. File formats (owner: legacy-formats, entries 2.23 to 2.26)

| ID | Topic | Ours today | `docs/spec/` | Proposed ruling |
|---|---|---|---|---|
| R-01 | 8-bit tile palette (details 3-6, `.gph` 3/5) | Standard IBM VGA mode-13h table (§3.1, §15.13, `vga-palette.ts`) | Both original programs hard-code their own table, close to VGA but with 168 for full intensity (`dos-palette.json`) | **Ruled (Jensen, 2026-10-15): adopt `dos-palette.json`**; keep the details-5/6 "first 16 entries" rule. Replace the table in 2.24. No sample uses 8-bit tiles, so no golden changes. |
| R-02 | Pre-vector shading | Sum every layer's tint, unclamped; cast on the highest shaded layer (§4.8, 2.15 OWNER ruling) | Per cell, the tint of the **highest layer whose tile has a non-zero tint** | Adopt `docs/spec/`: our rule was a guess the 2.15 ruling made for lack of facts |
| R-03 | Pre-vector background image | Becomes `backgroundImage`, draw type 1 (parallax) | The original engine loses the name (a bug); the editor keeps it | Keep the image (editor behaviour), with a compatibility note. Rule the draw type (docs/spec says nothing about parallax) |
| R-04 | Minor-2 board `coordType` | Absent in minor 2, defaults to 0 | The editor reads a trailing byte for minor 2 too; the engine keeps the previous board's value | Read the byte when exactly one byte remains, else 0. Check the 144 TK2 minor-2 boards for that trailing byte before ruling |
| R-05 | Pre-vector empty program slots | Every slot kept, empty region (§4.8 OWNER) | Empty entries dropped | Rule, together with R-06: it changes the indices scripts see |
| R-06 | Vector-board empty item slots | Slot kept (§4.2) | The original engine skips them **without keeping the slot**, so later items shift down | The reader keeps raw slots (round-trip, §1.7). The runtime numbering scripts see is ruled by board-rendering/movement-triggers at inception |
| R-07 | Start-position fallback | Vector: 64, 64, 1 when ≤ 0; pre-vector: the whole start becomes (64, 64) if either axis ≤ 0 | Each axis independently: `startX ≤ 0 → 64`, `startY ≤ 0 → 64`, `startL ≤ 0 → 1` | Adopt per-axis for both layouts |
| R-08 | `.tpk` entry names | `/` (§13.1); our writer emits `/` | Legacy PAKs store `\` and lookup "must use `\`" | The reader accepts both (verified on `example_game.tpk`). Our distribution package keeps `/` as a Reawakened rule. Update §13's "no sample package exists" |
| R-09 | Default sprite polygons | "A small rectangle at the feet" (§6) | Collision (−15,−15)–(15,0), activation (−24,−24)–(24,8); missing diagonals fall back to the nearest horizontal; missing idle falls back to walk | Adopt the exact values; the fall-backs are runtime (movement-triggers) |
| R-10 | Animated GIF as animation | Frame count, size and per-frame delay from the GIF (§7.2) | Size from the first page, **one delay from the first page's frame time**, transparent colour from the first page's background colour (magenta if absent) | Adopt for parity; owner tk2-support 16.12 (GIF decoder) |
| R-11 | `.spc` usable-in-battle/menu flags | Plain flags | The 3.1 editor writes them inverted relative to its checkboxes (inferred) | Record the compatibility note; battle (epic 7) rules the meaning |
| R-12 | Compiled `.prg` | §9.1: detect by first byte `00`; support optional | Same, and its full layout | The dump misreports `start_compiled.prg` as "RPGCode text program … 1 lines". Fix the detection in 2.24; support stays out (epic 3 Boundaries) |
| R-13 | Legacy `.sav` | §11 outline only; E-122 optional, an open question in menu-party-save | Full layout for minors 0-4, including the serialised thread state, and a note that positions are indices into the original compiler's instruction list | The open question is now only about scope. Layout facts migrate into `docs/spec/formats/save-game.md` (already there) |
| R-14 | Formats with no reader | `.tbm` (no owner), `.tan` and `.gph` v2 (tk2-support 16.7) | All current 3.1 formats | `.tbm` gets entry 2.25. `.tan`/`.gph` stay with 16.7, which now cites `docs/spec/formats/tiles.md` (speed 0 invalid; detail 4/6 COLORREF quirk) |
| R-15 | Tile shading arithmetic | `clamp(src + shade + ambient, 0, 255)` (§4.5) | Same clamp, but the original first replaces pure white with (245, 245, 245) and pure black with (10, 10, 10) so shading can tint them | Rule for board-rendering (render-time) |
| R-16 | Level-up arithmetic | E-78 one rule | The original uses `experienceIncrease` three different ways; "pick one and document it" | Battle (epic 7) rules it |
| R-27 | Standalone EXE (`CMP1`) | §13.1, unchanged in every version since fa24678 (2026-10-10): last 12 bytes are `CMP1`, `i32` ZIP offset, `i32` ZIP length, little-endian. The loader (`package.ts`) accepts `offset + length ≤ trailerStart`. L21 refuses trailer-less EXEs (TK2 Pro exports, `zip.exe`, 07bcd38) | Same trailer, field for field: `CMP1`, engine length *E* (= ZIP offset), ZIP length *Z*. Adds that the file is always exactly `E + Z + 12` bytes, the inner ZIP is a legacy PAK (`main.gam` at the root, `\` names), the engine extracts it to `%TEMP%\temp.tpk` and says "This application is corrupt." on failure. It says nothing about TK2 Pro EXEs | No layout conflict; the example EXE loads. Keep our tolerance of bytes between ZIP and trailer (lenient reader) or tighten to `E + Z + 12`: a 2.23 call. L21 migrates as a Reawakened rule. Writing side: T-70 appends **our** distribution package (`/` names, `Main/<game>.gam`, `manifest.json`), not a legacy PAK, so an EXE we write would not run on the 3.1 engine. That is a deliberate Reawakened rule to state in 2.23, not a defect |
| R-25 | Content only we have | §1.1 code-page round trip, §1.2 bounds checks, §1.5 ASCII fold (2.21), §1.7 residue, §4.2/§4.8 size limits, §4.8 OWNER rulings, §10 PNG/JPEG decoding and the image-kind rulings, §13 loose folder, L1–L26 and the distribution manifest, the TK2 Pro EXE refusal (L21), §14 checklist | Absent | Migrates into `docs/spec/` as Reawakened rule blocks (2.23). Nothing is dropped |

## B. Toolkit 1/2 formats (owner: tk2-support, entry 16.13)

`docs/spec/formats/legacy/` covers the same ground as our §15, from the original programs' reading logic. §15 is from 300+ real archive files. They agree on most layouts; where they differ, the files decide.

| ID | Topic | Finding | Proposed ruling |
|---|---|---|---|
| R-17 | Text `.anm` frame count | docs/spec: a "frame UB" line, "files from the Toolkit always stored UB = 50". The corpus: **all 17** text `.anm` write `0` and store 51 frames | Keep §15.7's rule (read the 51-frame block by position). docs/spec's own note that the editor always reads 51 supports it. Correct the UB claim |
| R-18 | Binary `.gam` minor < 3, rows 10 and 21 | docs/spec: `int` (field 11 and 23′). §15.14: **`i16`**. `i16` reads all 15 binary minor-2 `.gam` files to the last byte; `int` leaves 1506 bytes on BusDriver and runs off FinalDestiny | Keep `i16` (corpus) and correct `docs/spec/formats/main-file.md`. Our code still reads `int` (16.6 not built); docs/spec's generated `main_minor1/2.gam` examples are written as `int` and need regenerating |
| R-19 | Text `.gam` header | §15.15 Q1 open: one reader tests for `RPGTLKIT mainForm` | docs/spec answers it: the 3.1 editor compares with `RPGTLKIT mainForm` (an accidental rename) and sends `RPGTLKIT MAIN` files to the TK1 reader. Accept both headers; closes Q1 |
| R-20 | Text `.ene` rest-image block | §15.15 Q4 open | docs/spec answers it: width and height, then a **fixed 19 × 7 grid** (133 lines) of which the top-left w × h part is used. 3 + 8 + 2 + 133 + 202 + 7 + 4 + 4 = 363, matching all 52 files. Closes Q4 |
| R-21 | Text `.ste` | STE2 deferred (no corpus sample) | docs/spec gives the 11 fields, and `examples/versions/status-effect/status_text.ste` is a sample. Rule it from docs/spec; mark it unverified against a real file |
| R-22 | Text `.tem` | §15.5 covers minor 2 only, and says a first value of `-2` marks an empty picture | docs/spec adds the minor-1 battle layout (32 names + 2 rest) and the per-frame interleave order (fight, special, defend, death). It describes **no `-2` marker for characters** (only for items) | Adopt the minor-1 rows. Rule the `-2` question; both corpus files are full-length, so neither form is exercised |
| R-23 | Text `.brd` | §15.3 documents it from 17 files | docs/spec: "not documented here" | Migrate §15.3 in as-is |
| R-24 | Toolkit 1 | Out of MVP (decision 2026-10-11) | docs/spec documents the TK1 main file, its `fight.dat` and v1 `.gph`, and ships samples (`main_tk1.gam`, `fight.dat`, `tile_v1.gph`) | Stays out of MVP; the samples are kept for a later entry |
| R-26 | §15 content only we have | Corpus counts, the six-game evidence, worked examples, the zero-byte placeholder decision, open questions 2, 3, 5, 6 and 8 | — | Migrates into `docs/spec/formats/legacy/` with its evidence |

## C. RPGCode (owner: rpgcode-vm, entry 3.27)

| ID | Topic | Ours (§9) | `docs/spec/engine/rpgcode-language.md` | Proposed ruling |
|---|---|---|---|---|
| R-30 | `^` (power) | Above unary minus, **right**-associative: `-2^2 = -4`, `2^3^2 = 512` (EXP-2) | Below unary, **left**-associative: `-2^2 = 4`, `2^3^2 = 64` | Adopt legacy for parity (scripts were written against it); EXP-2 changes. Entry 3.5 has not started |
| R-31 | `!=` | Adjacent `!=` is "not equal" (LEX-3) | `a != b` is `a!` `=` `b`, an **assignment**, because `!` is a type sigil | **Ruled (Jensen, 2026-10-15): keep LEX-3** (adjacent `!=` is "not equal") as a Reawakened rule beside the legacy behaviour; an edge case. 3.27 records it and may add a compatibility warning |
| R-32 | Blocking command inside a thread | Waits yield per thread (§9.15) | Freezes the whole game until it completes; threads do not pump messages | Keep ours as a Reawakened rule (G1 step machine); document the departure |
| R-33 | Per-tick thread budget | Provisional, tuned in 3.9 (§9.15 THR-3) | `(fps − 60) × 10` instructions, at least 10; unsigned wrap below 60 fps | Input to 3.9's tuning. The wrap is a quirk not to reproduce |
| R-34 | Object lifetime | Freed at end of the tick it becomes unreferenced, no destructor (§9.17) | Members stored as globals `<handle>::<member>`; collector every 10 minutes; no destructor | Keep ours as a Reawakened rule (deterministic). Check whether any script reads `<handle>::<member>` names directly |
| R-35 | Built-in vs script method of the same name | Script functions: last-wins (MOD rulings) | Built-ins bind at compile time, so a script method named like a built-in is **never called** at those sites | Rule: legacy parity, or ours with a warning |
| R-36 | Catalogue size | 271 names (§9.11, `command-effect-catalogue.json`) | 282 names, 14 aliases | Add the 8 missing: `empty`, `fbranch`, `mbox`, `newplyr` (`newplayer` is its alias), `restorearrayscreen`, `underarrow`, `itemwalkspeed`, `shopcolors`. `resumenext`, `seterrorhandler` and `setresumenexthandler` are already language-level in ours. Obsolete commands "raise an error and the statement is skipped" |
| R-37 | Virtual variables | Read and write, includes `threads[i]` and `ambientRed/Green/Blue` (§9.10) | 44 **read-only**; `playerx/y` are **tile** positions; assigning one breaks its link for the session | Rule each name. 24 compile-time constants (`tkMV_*`, `tkVT_*`, `tkPRG_*`, `tkDIR_*`) to check against §9.10 |
| R-38 | Execution details | — | The engine prepends a line `1` (error lines off by one); after a built-in error execution continues with the next statement; `FileInput` drops the last character of every line; edits to a program during play are not picked up | Rule each for 3.7, 3.8 and 3.16 |
| R-39 | String truthiness | `&&`, `||`, `!` use numeric truthiness (§9.16) | Strings are true unless they equal `"off"` (case-insensitive), so `""` is true | Rule for 3.5/3.12 |

## D. Engine behaviour (owners: epics 4 to 9; Notes now, ruled at inception)

| ID | Topic | Ours (engine-features) | `docs/spec/engine/` | Owner |
|---|---|---|---|---|
| R-50 | Sprite speed | E-04: game speed ±10% per step | 4 px per `speed`; one tile = `8 × speed`; game speed makes each 4-px advance take `speed − 100 ms × gameSpeed`, at least one frame | movement-triggers |
| R-51 | Sprite-sprite collision | E-27: diversion, wait, or stop | Loser **freezes for 2 s**; a stationary sprite loses to a moving one, then the controlled player wins, then the faster, then the later in draw order | movement-triggers |
| R-52 | Activation precedence | E-43: items before regions, most-in-front then nearest | Same, plus: if several board programs match, the **last in board order** wins | movement-triggers |
| R-53 | Board-edge arrival | E-28: aligned to an 8 px or 32 px grid | Keeps the position along the edge (marked inferred) | movement-triggers |
| R-54 | Wall sliding | E-26: < ~45° | Glancing hit ≥ 45°, or **≥ 27° on isometric boards** | movement-triggers |
| R-55 | Z-order | E-29: only the moving sprite is re-inserted | The original re-inserts it at the end of the list (a bug), so the last mover draws on top | board-rendering |
| R-56 | Frame loop | E-04: uncapped up to about 120 fps | No cap at all (a 120 fps cap existed but was disabled). Our fixed tick (AD-2) is unaffected | board-rendering |
| R-57 | Battle model | E-72 to E-77 | Charge +3 per tick (±2 per speed/slow effect); act at 75 (players) and 123 (enemies); `skill` is always −1; outcomes 0-4; `fightInform` codes 6 and 7 never sent; "No enemies of skill level N found." | battle |
| R-58 | Golden-image oracle | Board-rendering Unknown: no expected images | `docs/spec/examples/renders/*.png` are renders of authored boards and tilesets from an independent renderer | board-rendering |
| R-59 | Audio | E-100 to E-104 | Every file went through the MIDI path (a bug); animation-frame sounds bypassed PAK extraction | audio-synth |
| R-60 | Editor behaviour | `editor-features.md` (not replaced) | `sys_test.prg` test runs, new-project defaults, Make EXE (the rebuild's T-70 is **Make package**; the EXE form is read, never written), the TK2 folder-upgrade wizard, the battle-plugin upgrade, `.gph` writing | editor-foundation, editor-assets-p0 |
| R-61 | Plugin contract | E-99, ADR 0004 | The 140-method callback interface, the native and COM export shapes, and the battle protocol | rpgcode-vm 3.23/3.24 (evidence), battle |

## Entries this report creates

| Epic | Entry | What |
|---|---|---|
| platform-baseline | 1.13 | ADR 0007: `docs/spec/` is normative; the precedence, rule-block and citation scheme; amend CLAUDE.md, guardrails, ADR 0006, README, CONTRIBUTING and the PR template |
| platform-baseline | 1.14 | Migrate `engine-features.md` into `docs/spec/engine/`, keeping every E-xx ID; record R-50 to R-61 as open conflicts for their owners |
| rpgcode-vm | 3.28 | Re-point every citation and delete `format-spec.md` and `engine-features.md` (placed here as the last of the three migrating epics in build order) |
| legacy-formats | 2.23 | Migrate §1-§14 into `docs/spec/formats/`; rule R-01 to R-16, R-25 and R-27 |
| legacy-formats | 2.24 | Align readers and the dump with 2.23 |
| legacy-formats | 2.25 | Tile bitmap (`.tbm`) reader and writer |
| legacy-formats | 2.26 | `docs/spec/examples/` in the dump gate |
| tk2-support | 16.13 | Migrate §15 into `docs/spec/formats/legacy/`; rule R-17 to R-24 and R-26 |
| rpgcode-vm | 3.27 | Migrate §9 into `docs/spec/engine/`; rule R-30 to R-39 |
