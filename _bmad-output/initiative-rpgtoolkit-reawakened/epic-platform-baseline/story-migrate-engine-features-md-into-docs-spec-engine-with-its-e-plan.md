---
title: 'Migrate engine-features.md into docs/spec/engine with its E-xx IDs'
type: 'chore'
ticket: '14'
created: '2026-10-15'
status: done
baseline_revision: '3509ec22bc67524ceaf142724245cf7e254f14db'
route: 'full'
route_source: 'auto'
risk: 'medium'
context: ['{project-root}/docs/guardrails.md', '{project-root}/docs/adr/0007-docs-spec-is-the-normative-specification.md', '{project-root}/_bmad-output/initiative-rpgtoolkit-reawakened/discovery/docs-spec-reconciliation.md', '{project-root}/docs/engine-features.md', '{project-root}/docs/spec/README.md']
---

<frozen-after-approval reason="human-owned intent — do not modify unless the human renegotiates">

## Intent

**Problem:** `docs/engine-features.md` (377 lines) holds the E-01…E-132 capability catalogue, and epics, plans and code cite those IDs everywhere. It was superseded and frozen by [ADR 0007](../../docs/adr/0007-docs-spec-is-the-normative-specification.md) decision 6, and entry 3.28 will delete it. Yet 78 distinct E-ids are cited in **64 files** outside it (636 `E-nn` tokens: 36 in `docs/`, 182 in `_bmad-output/`, and 5 in three `packages/core` files). None of the seven `docs/spec/engine/` pages carries a single E-id today, so every one of those citations dangles the moment the old file goes. Two blocks of the file have no other home: the "a rebuild should…" guidance (our own design rules, with no `docs/spec/` counterpart) and the §14 parity checklist, which `docs/guardrails.md:99` (G5) cites by name and which exists nowhere in `docs/spec/`.

**Approach:** One doc-only commit (G7). Move the E-xx capability paragraphs of §2–§13 onto the `docs/spec/engine/` page that already covers the behaviour, each E-id becoming an explicit lowercase anchor `<a id="e-NN"></a>` on the line before its paragraph ([ADR 0007](../../docs/adr/0007-docs-spec-is-the-normative-specification.md) decision 4). Migrate the twelve "a rebuild should…" sentences as **Reawakened rule** blocks (decision 2). Land §14 as its own engine page and point `docs/spec/README.md` at it. Where an E-xx statement contradicts `docs/spec/` — the twelve findings R-50 to R-61 of the reconciliation note — the page records **both sides verbatim with citations** and names the owner epic that rules it at inception; this entry rules none of them. Section 1.1–1.3 (the legacy process, the concurrency model, the rebuild decomposition) migrate as prose and one Reawakened-rule section.

## Boundaries & Constraints

**Always:** Cite `docs/spec/<path>#<anchor>` in the migrated text (ADR 0007 decision 4), and keep the E-xx anchor form exactly `<a id="e-NN"></a>` (lowercase, two-digit, on its own line before the labelled paragraph). Every E-id that exists in the source appears **exactly once** across `docs/spec/engine/` (99 of them — see the census below). Keep the 12 R-50…R-61 conflicts recorded on the page that owns the behaviour, each row naming its owner epic, and rule none of them. Give every Reawakened-rule block the marker wording of ADR 0007 decision 2 (**Reawakened rule**) so an implementer can tell our rule from the legacy fact. Keep `docs/spec/`'s vocabulary: "the original engine", "Compatibility note", "Inferred", "Unknown". Cite R-04/R-17/R-18-style corpus facts from `_bmad-output/initiative-rpgtoolkit-reawakened/discovery/docs-spec-reconciliation.md` where a statement rests on them.

**Never:** Edit `docs/format-spec.md` or `docs/engine-features.md` (both frozen under their banners until 3.28; ADR 0007 decision 6). Edit any code, test, golden or `tickets.toml`. Re-rule R-50 to R-61 (they belong to the movement-triggers, board-rendering, battle, audio-synth, editor-foundation and rpgcode-vm epics) or R-30 to R-39 (3.27's). Rewrite the RPGCode §9 threads prose that ticket 3.27 also touches (see the boundary row). Open `../rpgtoolkit` (G7). Add an E-xx anchor to a `docs/spec/formats/` page — ADR 0007 decision 4 puts them on the engine pages (the two format-heavy cases are named for the owner below). Touch any file outside `docs/spec/engine/` and `docs/spec/README.md` (the README row is itself an owner decision below).

## I/O & Edge-Case Matrix

The twelve R-50…R-61 conflicts (the reconciliation note's section D), plus the open points this plan raises. "Owner" is the epic that rules the item at inception; this entry records both sides and rules nothing. Both sides were re-read from the files at the line numbers given.

| ID | Topic | Legacy side (`docs/engine-features.md`) | `docs/spec/engine/` side | Owner epic | Landed code |
|----|-------|----------------------------------------|--------------------------|------------|-------------|
| R-50 | Sprite speed / game speed | `E-04` "game speed offset (−4…+4, ±10 % per step)" — `docs/engine-features.md:83` | "the time per 4-pixel advance becomes `speed − 100 ms × gameSpeed`, never less than one frame" — `docs/spec/engine/movement-and-collision.md:23` | movement-triggers | none |
| R-51 | Sprite–sprite collision outcome | `E-27` "diversion … wait … stops" — `docs/engine-features.md:142` | "one freezes for 2 seconds. Who loses: a stationary sprite … otherwise the faster sprite … otherwise the one later in drawing order" — `docs/spec/engine/movement-and-collision.md:53` | movement-triggers | none |
| R-52 | Activation precedence | `E-43` "most directly in front and then nearest … Items take precedence over regions" — `docs/engine-features.md:179` | items first, then board programs, and "the last one in board order wins" — `docs/spec/engine/movement-and-collision.md:61-62` | movement-triggers | none |
| R-53 | Board-edge arrival alignment | `E-28` "aligned to an 8 px or 32 px grid" — `docs/engine-features.md:146` | "keeping its position along the edge, inferred" — `docs/spec/engine/movement-and-collision.md:82` | movement-triggers | none |
| R-54 | Wall-sliding threshold | `E-26` "less than about 45° to the movement direction" — `docs/engine-features.md:138` | "angle ≥ 45°, or ≥ 27° on isometric boards" — `docs/spec/engine/movement-and-collision.md:44` | movement-triggers | none |
| R-55 | Z-ordering update | `E-29` "Only the moving sprite is re-inserted each step" — `docs/engine-features.md:151` | "the original engine re-inserts the moving sprite at the end of the drawing list (a bug)" — `docs/spec/engine/movement-and-collision.md:55` | board-rendering | none |
| R-56 | Frame-loop cap | `E-04` "uncapped up to about 120 fps" — `docs/engine-features.md:83` | "no frame-rate cap … A 120 fps cap was defined but disabled" — `docs/spec/engine/main-loop-and-startup.md:47` | board-rendering | fixed tick (AD-2), unaffected |
| R-57 | Battle model & notification quirks | `E-72`/`E-74` charge 75/123, FP ±10 %, crit DP bypass — `docs/engine-features.md:237,241` | `skill` always −1 (`plugins-and-battle.md:64`); random-encounter table and "No enemies of skill level N found." (`:98`); charge/outcome codes — `docs/spec/engine/plugins-and-battle.md:80-99` | battle | none |
| R-58 | Golden-image oracle | §14 "exact scroll-cache behaviour" as nice-to-have; no reference images — `docs/engine-features.md:371` | `docs/spec/examples/renders/*.png` are renders from an independent renderer (`docs/spec/tools/render.py`) | board-rendering | none |
| R-59 | Audio routing & frame audio | `E-100`/`E-101` loop music + one-shot effects — `docs/engine-features.md:319,321` | "every file through its MIDI path because of a string-comparison bug; animation frame sounds bypassed PAK extraction (inferred)" — `docs/spec/engine/display-input-audio.md:49` | audio-synth | none |
| R-60 | Editor / test-game behaviour | engine runtime only; tools in `editor-features.md` — `docs/engine-features.md:6` | `engine <file.gam> <program.prg>` program test mode, editor "Run program", per-resolution frame estimate — `docs/spec/engine/main-loop-and-startup.md:13,59` | editor-foundation, editor-assets-p0 | none |
| R-61 | Plugin contract & API shape | `E-99` unknown-call back-off, native plugins — `docs/engine-features.md:313` | 140-method callback interface, native/COM export shapes, battle protocol — `docs/spec/engine/plugins-and-battle.md:1-247` | rpgcode-vm (3.23/3.24 evidence), battle | `packages/core/src/ports/input.ts:79`, `requests.ts:52` |
| OPEN-1 | Entry verify wording | tickets.toml says "Every E-01 to E-132 ID appears exactly once" — `_bmad-output/initiative-rpgtoolkit-reawakened/epic-platform-baseline/tickets.toml:169` | only **99** IDs exist; the gaps are deliberate (see the census) | **Proposed (needs owner)** | — |
| OPEN-2 | Anchor home for format-heavy E-ids | "onto the `docs/spec/engine/` page that covers it" — `tickets.toml:168` | ADR 0007 decision 4 puts every E-xx anchor on an engine page (`docs/adr/0007-…md:25`), but E-120…E-123 (saves) and E-131 (package) are documented in `docs/spec/formats/` | **Proposed (needs owner)** | — |
| OPEN-3 | Parity-checklist home | §14 cited by `docs/guardrails.md:99`; no home in `docs/spec/` | new `docs/spec/engine/parity-checklist.md` + a README row | **Proposed (needs owner)** | — |
| OPEN-4 | E-81 / E-82 have no engine page | `E-81` `docs/engine-features.md:277`, `E-82` `:279` | `docs/spec/engine/` has no inventory/equipment page; only `docs/spec/formats/item.md` and callback #128 | **Proposed (needs owner)** | — |
| OPEN-5 | §1.2 blocking-primitives sentence | "Blocking primitives … pump input and redraw while blocking" — `docs/engine-features.md:44` | "Threads do not pump window messages. A blocking command … inside a thread freezes the whole game" — `docs/spec/engine/rpgcode-language.md:59` — this is R-32, owned by 3.27 | rpgcode-vm (3.27) | AD-9 per-thread waits (landed) |
| OPEN-6 | E-112 joystick omitted from `docs/spec` | `E-112` "Joystick/gamepad" — `docs/engine-features.md:337` | `docs/spec/engine/display-input-audio.md#input` (`:26-39`) lists no joystick/gamepad | movement-triggers | `packages/core/src/ports/input.ts:34` (`GamepadInput`) |
| OPEN-7 | 3.27 / 1.14 boundary on threads | 1.14 adds the E-33/E-93/E-95 anchors and their capability sentences; 3.27 rewrites the §9 language/execution/threads prose and rules R-30…R-39 | `docs/spec/engine/rpgcode-language.md#threads` | **Decided here (sequencing)** | — |

</frozen-after-approval>

## Code Map

- `docs/engine-features.md` (377 lines, source, frozen) — sections and verified line numbers: §1.1 `:13-38`, §1.2 `:40-45`, §1.3 `:46-61`; §2 `:63-88`; §3 `:91-115`; §4 `:118-166`; §5 `:170-193`; §6 `:195-224`; §7 `:227-263`; §8 `:266-290`; §9 `:293-314`; §10 `:317-328`; §11 `:331-340`; §12 `:343-352`; §13 `:355-360`; §14 `:363-377`.
- **Census (verified):** exactly **99** distinct E-ids are present. Missing from the E-01…E-132 range and **not errors**: E-07…E-09, E-35…E-39, E-64…E-69, E-88…E-89, E-105…E-109, E-114…E-119, E-124…E-129 (33 gaps). Every id that exists must appear exactly once after migration.
- `docs/spec/engine/main-loop-and-startup.md` (77 lines) — headings `#command-line`, `#start-up-sequence`, `#main-loop`, `#blocking-programs`, `#timing`, `#drawing-a-frame`, `#shutdown-and-reset`.
- `docs/spec/engine/movement-and-collision.md` (105 lines) — `#positions`, `#movement-modes`, `#speed`, `#sprite-states`, `#collision-with-the-board`, `#collision-between-sprites`, `#activation-programs-and-items`, `#moving-between-boards`, `#path-finding`, `#scrolling`, `#player-statistics-and-levels`.
- `docs/spec/engine/display-input-audio.md` (70 lines) — `#window-and-display`, `#input`, `#audio`, `#video`, `#fonts`.
- `docs/spec/engine/plugins-and-battle.md` (247 lines) — `#plugin-roles`, `#two-plugin-kinds`, `#rpgcode-command-plugins`, `#menu-plugin`, `#battle-protocol`, `#battle-model`, `#enemy-ai`, `#random-encounters`, `#callback-interface`.
- `docs/spec/engine/rpgcode-language.md` (90 lines) — `#lexical-rules`, `#keywords-and-structure`, `#expressions`, `#execution`, `#threads`, `#objects-and-memory`, `#virtual-variables`, `#compile-time-constants`, `#plugin-commands`.
- `docs/spec/engine/rpgcode-functions.md` (352 lines) — sections end in a count (e.g. `## Message window, text & fonts (30)`), so their real anchors carry the number (e.g. `#message-window-text--fonts-30`); the builder confirms each slug and uses the count-suffixed form. Sections: `#message-window-text--fonts-30`, `#program-flow-errors--debugging-25`, `#variables-strings--math-30`, `#threads-7`, `#board-tiles-vectors--screen-effects-33`, `#players-party--sprite-movement-31`, `#items-inventory-shop--gold-28`, `#battle-stats--menus-29`, `#graphics-canvases-animation--video-31`, `#mouse-buttons--cursor-maps-11`, `#audio-12`, `#files-saves--os-15`, `#not-callable-by-name`.
- `docs/spec/README.md:13-19` — the engine-page table; a new row for `parity-checklist.md` goes here (OPEN-3).
- `docs/guardrails.md:99` (G5) — "Engine parity checklist (engine-features §14, migrating to `docs/spec/engine/` under ADR 0007)"; out of scope to edit, but the target page must exist for the sentence to become true.
- `docs/adr/0007-docs-spec-is-the-normative-specification.md:25` (decision 4, the anchor form) and `:24-35` (the Reawakened-rule decision is decision 2, `:21-24`).
- `_bmad-output/initiative-rpgtoolkit-reawakened/discovery/docs-spec-reconciliation.md` — section D is the R-50…R-61 list; sections A/B/C are the R-01…R-49 rulings this entry must not touch.
- `_bmad-output/initiative-rpgtoolkit-reawakened/epic-platform-baseline/tickets.toml:165-169` — entry 14 (`after = [13]`, `hitl = true`, `risk = medium`); the `verify` string is at `:169`.

### E-id landing map (all 99; primary page — some carry a cross-reference)

| Target page | E-ids (source line) |
|---|---|
| `main-loop-and-startup.md` | E-01 `:65`, E-02 `:67`, E-03 `:76`, E-04 `:83`, E-06 `:87`, E-10 `:93` (xref `formats/board.md`), E-12 `:97` (xref `formats/board.md`), E-33 `:159` (xref `rpgcode-language.md#threads`), E-52 `:201`, E-57 `:211`, E-96 `:307` (xref `rpgcode-language.md#execution`), E-120 `:345`, E-121 `:347`, E-122 `:349` (xref `formats/save-game.md`), E-130 `:357`, E-131 `:358` (xref `formats/packaging-and-paths.md`) |
| `movement-and-collision.md` | E-11 `:95` (xref `formats/board.md`), E-19 `:114`, E-20 `:120`, E-21 `:122`, E-22 `:124`, E-23 `:130`, E-24 `:132`, E-25 `:134`, E-26 `:136`, E-27 `:142`, E-28 `:144`, E-29 `:151`, E-30 `:153`, E-34 `:161`, E-40 `:176`, E-41 `:177`, E-42 `:178`, E-43 `:179`, E-44 `:180`, E-45 `:181`, E-47 `:183`, E-48 `:184`, E-51 `:199`, E-78 `:260`, E-85 `:285` |
| `display-input-audio.md` | E-05 `:85`, E-13 `:99` (xref `formats/tiles.md`), E-16 `:105`, E-17 `:107`, E-49 `:185`, E-50 `:197`, E-53 `:203` (xref `formats/tiles.md`), E-61 `:219`, E-62 `:221`, E-100 `:319`, E-101 `:321`, E-103 `:325`, E-104 `:327`, E-110 `:333`, E-111 `:335`, E-112 `:337` (OPEN-6), E-113 `:339`, E-132 `:359` |
| `plugins-and-battle.md` | E-18 `:112` (xref `formats/board.md#header`), E-54 `:205` (xref `formats/animation.md`), E-70 `:231`, E-71 `:235`, E-72 `:237`, E-73 `:239`, E-74 `:241`, E-75 `:243`, E-76 `:245`, E-77 `:253`, E-79 `:262`, E-80 `:268`, E-81 `:277` (OPEN-4), E-82 `:279` (OPEN-4), E-95 `:305` (xref `rpgcode-language.md#threads`), E-99 `:313`, E-123 `:351` |
| `rpgcode-language.md` | E-15 `:103`, E-46 `:182`, E-87 `:289`, E-90 `:295`, E-91 `:297`, E-92 `:299`, E-93 `:301`, E-98 `:311` |
| `rpgcode-functions.md` | E-14 `:101`, E-31 `:155`, E-32 `:157`, E-55 `:207`, E-56 `:209`, E-58 `:213`, E-59 `:215`, E-60 `:217`, E-63 `:223`, E-83 `:281`, E-84 `:283`, E-86 `:287`, E-94 `:303`, E-97 `:309`, E-102 `:323` |
| `parity-checklist.md` (new) | the §14 table `:363-377`; it references E-40…E-49 but introduces no new id |

### Reawakened-guidance sentences to migrate as rule blocks (12)

| # | `docs/engine-features.md` line | Target |
|---|---|---|
| 1 | `:59-60` core is deterministic, emits draw/audio commands, seam to runner | `main-loop-and-startup.md` — new `## Reawakened architecture` section (also holds §1.3) |
| 2 | `:44` a resumable interpreter for runtimes without OS threads | `rpgcode-language.md#execution` |
| 3 | `:83` a fixed simulation tick with real elapsed time, keep perceived speeds | `main-loop-and-startup.md#timing` |
| 4 | `:191` may use an internal event bus, observable firing rules must hold | `movement-and-collision.md#activation-programs-and-items` |
| 5 | `:197` render at the logical resolution and scale | `display-input-audio.md#window-and-display` |
| 6 | `:229` ship a default battle UI; keep the rules in the core | `plugins-and-battle.md#battle-protocol` |
| 7 | `:262` RPGCode-written battle systems drive the same core operations | `plugins-and-battle.md#battle-protocol` |
| 8 | `:309` sandbox script file I/O to the game's save area | `rpgcode-functions.md#files-saves--os-15` |
| 9 | `:313` one plugin contract, editable manifest, host requests, not trust-gated, no legacy binaries | `plugins-and-battle.md#plugin-roles` |
| 10 | `:327` transcode video on import to a portable format | `display-input-audio.md#video` |
| 11 | `:358` our own single-file distribution package (`manifest.json { schema, main, index }`) and import of the legacy ones | `main-loop-and-startup.md#command-line` (xref `formats/packaging-and-paths.md`) |
| 12 | §14 parity checklist `:363-377` | new `docs/spec/engine/parity-checklist.md` |

Section map for the three legacy-ness sections: §1.1 `:13-38` (the legacy process and its subsystem table) migrates as legacy-fact prose into `main-loop-and-startup.md` (command line, start-up, main loop); §1.2 `:40-45` (single-threaded cooperative, blocking vs threads) migrates as legacy facts into `main-loop-and-startup.md#blocking-programs` and `rpgcode-language.md#threads`, with its blocking-primitives sentence recorded as the OPEN-5 cross-reference to 3.27's R-32; §1.3 `:46-61` (the rebuild decomposition diagram and the seam) migrates as Reawakened rule #1.

## Tasks & Acceptance

**Execution:**
- [ ] `docs/spec/engine/main-loop-and-startup.md` — add E-01…E-06, E-10, E-12, E-33, E-52, E-57, E-96, E-120…E-122, E-130, E-131 as anchors over their migrated paragraphs; add the §1.1/§1.2 legacy facts, the `## Reawakened architecture` section (§1.3 + guidance #1), the `#timing` and `#blocking-programs` Reawakened rules (#2, #3), and the R-56 and the OPEN-5 cross-reference
- [ ] `docs/spec/engine/movement-and-collision.md` — add E-11, E-19…E-30, E-34, E-40…E-48, E-51, E-78, E-85; place the R-50…R-55 blocks (both sides, owner epics) and Reawakened guidance #4
- [ ] `docs/spec/engine/display-input-audio.md` — add E-05, E-13, E-16, E-17, E-49, E-50, E-53, E-61, E-62, E-100…E-104, E-110…E-113, E-132; place R-59, OPEN-6 and Reawakened guidance #5, #10
- [ ] `docs/spec/engine/plugins-and-battle.md` — add E-18, E-54, E-70…E-82, E-95, E-99, E-123; place R-57, R-61 and Reawakened guidance #6, #7, #9
- [ ] `docs/spec/engine/rpgcode-language.md` — add E-15, E-46, E-87, E-90…E-93, E-98 (the E-xx **anchors only**; leave the §9 language/threads prose to 3.27 — OPEN-7)
- [ ] `docs/spec/engine/rpgcode-functions.md` — add E-14, E-31, E-32, E-55, E-56, E-58…E-60, E-63, E-83, E-84, E-86, E-94, E-97, E-102; place Reawakened guidance #8
- [ ] `docs/spec/engine/parity-checklist.md` (new) — the §14 table as an engine page, with a preamble naming `docs/guardrails.md:99` (G5)
- [ ] `docs/spec/README.md:13-19` — one row for `engine/parity-checklist.md` (OPEN-3)

**Acceptance Criteria:**
- Given the 99 E-ids that exist in `docs/engine-features.md`, when `grep -o 'id="e-[0-9]*"' docs/spec/engine/` is run, then each appears exactly once and the set equals the source set; the gaps E-07…E-09, E-35…E-39, E-64…E-69, E-88…E-89, E-105…E-109, E-114…E-119, E-124…E-129 are absent and unexplained (they were never ids).
- Given each of R-50 to R-61, when the owning page is read, then both the `docs/engine-features.md` side and the `docs/spec/` side are quoted with `path:line` citations and the owner epic is named, and the plan rules none of them.
- Given the twelve "a rebuild should…" sentences of §1.3, §2–§13, when the pages are read, then each is present in a block opening **Reawakened rule**, and guidance #12 is the `parity-checklist.md` page.
- Given `docs/guardrails.md:99` names "the engine parity checklist", when `docs/spec/engine/parity-checklist.md` is opened, then it holds the §14 table and is reachable from `docs/spec/README.md`.
- Given the commit, when its files are listed, then they are within `docs/spec/engine/` and `docs/spec/README.md` only, and `git diff --stat docs/format-spec.md docs/engine-features.md` is empty.

## Implementation Notes

- **Ruled (Jensen, 2026-10-15): OPEN-1 to OPEN-6 are approved as proposed, and OPEN-7 stands as sequencing.** Where the rows below and the paragraphs say "Proposed (needs owner)", read "Ruled". In short: OPEN-1 the entry's `verify` is amended to the 99 E-ids that exist (done in `tickets.toml`); OPEN-2 every E-xx anchor stays on an engine page, with a cross-reference to the formats page for E-120 to E-123 and E-131; OPEN-3 a new `docs/spec/engine/parity-checklist.md` and one row in `docs/spec/README.md` (this widens the stated paths by that one row); OPEN-4 E-81 and E-82 land in `docs/spec/engine/plugins-and-battle.md#menu-plugin`, linking to `docs/spec/formats/item.md`; OPEN-5 record §1.2's blocking sentence as a pointer to 3.27's R-32 and change nothing else; OPEN-6 keep the E-112 anchor and mark joystick and gamepad as a Reawakened addition for the movement-triggers epic. OPEN-7: ticket 3.27 landed first (PR 62), so 1.14 adds only the E-33, E-93 and E-95 anchors and capability sentences and writes none of the §9 prose.
- **OPEN-1 — the entry's `verify` wording is wrong, and the owner must amend it.** `tickets.toml:169` says "Every E-01 to E-132 ID appears exactly once in `docs/spec/engine/`". Only 99 of those numbers exist; the 33 gaps are not omissions to be filled. Proposed replacement: "**every E-id that exists in `docs/engine-features.md` (99 of them) appears exactly once in `docs/spec/engine/`**, each R-50 to R-61 conflict is recorded with its owner epic, and the commit touches only `docs/`". Alternative: leave it — but then the acceptance test can never pass as written. This is a ticket-text change, so it needs the owner, not the builder.
- **OPEN-2 — where the format-heavy E-ids' anchors live.** `tickets.toml:168` says "onto the `docs/spec/engine/` page that covers it" and ADR 0007 decision 4 (`docs/adr/0007-…md:25`) says the anchors are carried "on the `docs/spec/engine/` pages". But E-120…E-123 describe the save file (documented at `docs/spec/formats/save-game.md`) and E-131 the package (`docs/spec/formats/packaging-and-paths.md`). Proposed answer: keep every anchor on an engine page (E-120/E-121/E-122 beside start-up in `main-loop-and-startup.md`, E-123 in `plugins-and-battle.md#menu-plugin`, E-131 in `main-loop-and-startup.md#command-line`), each with an explicit cross-reference to the format page, so the ADR and the entry both hold. Alternative: amend ADR 0007 decision 4 to permit anchors on format pages — a decision this entry cannot make. All format-heavy ids are E-10, E-11, E-12, E-13, E-18, E-54, E-120, E-121, E-122, E-123, E-131 (`docs/engine-features.md:93,95,97,99,112,205,345,347,349,351,358`).
- **OPEN-3 — the parity checklist's home.** Nothing in `docs/spec/` holds §14 (`docs/engine-features.md:363-377`), yet `docs/guardrails.md:99` leans on it. Proposed answer: a new `docs/spec/engine/parity-checklist.md` holding the table verbatim as legacy parity requirements, linked from `docs/spec/README.md:13-19`. Alternative: append it to `docs/spec/engine/main-loop-and-startup.md` — fewer files, but the checklist is a whole-document summary, not a loop fact. The README row is `docs/spec/README.md` — outside the "only `docs/spec/engine/`" boundary the ticket states, so the owner should confirm it. If declined, 3.28 (or the README owner) adds the row.
- **OPEN-4 — E-81 (inventory) and E-82 (equipment) have no engine page.** `docs/engine-features.md:277-280` describes inventory handles, use consumption, equipment slots and equip bonuses; `docs/spec/engine/` has no menu-rules page beyond `#menu-plugin`, and the layouts are at `docs/spec/formats/item.md`. Proposed answer: land both anchors in `docs/spec/engine/plugins-and-battle.md#menu-plugin` (the menu owns the inventory and equip screens) with a cross-reference to `docs/spec/formats/item.md`, and record the R-57/R-61-adjacent engine-rule gap as a note for the menu-party-save epic's inception. Alternative: a new `docs/spec/engine/menu-and-party.md` page.
- **OPEN-5 — §1.2's blocking-primitives sentence contradicts `docs/spec` and is 3.27's.** `docs/engine-features.md:44` says a blocking primitive "pump[s] input and redraw[s] while blocking"; `docs/spec/engine/rpgcode-language.md:59` says a blocking command inside a thread "freezes the whole game". This is R-32 (`docs-spec-reconciliation.md`, section C), owned by ticket 3.27, which ruled it (blocking freezes the whole game; the screen keeps redrawing so the window does not look hung). This entry records the cross-reference and does not re-rule it.
- **OPEN-6 — E-112 (joystick/gamepad) has no `docs/spec` counterpart.** `docs/engine-features.md:337` lists an optional joystick/gamepad; `docs/spec/engine/display-input-audio.md#input` (`:26-39`) lists only keys, the mouse and the script wait queue. Landed code has `GamepadInput` (`packages/core/src/ports/input.ts:34`). Proposed answer: keep the E-112 anchor and record it as an **Unknown / owner** open conflict for the movement-triggers epic (input is CAP-8), stating that `docs/spec` is silent and the Reawakened `GamepadInput` port exists. Alternative: treat the silence as "legacy parity only for keyboard/mouse" and mark E-112 as a Reawakened addition.
- **OPEN-7 — the 3.27 boundary on the threads text (decided here as sequencing).** Ticket 3.27 (`epic-rpgcode-vm/story-migrate-section-9-into-docs-spec-engine-and-rule-the-rpgcode-plan.md`) migrates `docs/format-spec.md` §9 onto `docs/spec/engine/rpgcode-language.md` and `rpgcode-functions.md`, rewrites `#threads` and `#execution`, and rules R-30…R-39 (including R-32 blocking and R-33 budget); it explicitly adds **no** E-xx anchors. Entry 1.14 owns the E-xx anchors and the engine-features §9 capability sentences (E-90…E-99, E-15, E-46, E-87), which include E-33, E-93 and E-95. To stop both editing the same paragraph: **3.27 lands the §9 language/execution/threads prose first** (it reverses the landed AD-9 design), **then 1.14 places the E-33/E-93/E-95 anchors and their one-line capability statements against the settled text**. If 1.14 is built first, it must write only the anchor lines and short statements and leave the §9 prose to 3.27, which then rebases. No E-xx anchor is a 3.27 deliverable, so `grep -o 'id="e-[0-9]*"' docs/spec/engine/rpgcode-language.md` is 1.14's acceptance signal.
- **Citation form.** Migrated citations are `docs/spec/<path>#<anchor>` (ADR 0007 decision 4). The reconciliation note's own citations are kept only where a migrated statement quotes them; the note is discovery evidence, not a deliverable.
- **Load for 3.28.** The re-pointing sweep must carry 78 distinct E-ids across 64 files (636 tokens: 36 in `docs/`, 182 in `_bmad-output/`, plus the code instances below). Code citations today: `packages/core/src/formats/board/model.ts:298` (E-18), `packages/core/src/ports/input.ts:34` (E-112), `:42` (E-03), `:79` (E-99), `packages/core/src/ports/requests.ts:52` (E-99). This entry changes those anchors' **home**, not the code; 3.28 re-points the code.
- **Risk is medium, not high.** No code, test or golden changes; the only acceptance risk is a missed or duplicated E-id, which the anchor-count check catches mechanically.

## Plan Change Log

- 2026-10-15 — initial plan, drafted from ticket 14 (`tickets.toml:165-169`), ADR 0007, the reconciliation note section D, `docs/guardrails.md` G5, a full read of `docs/engine-features.md`, the seven `docs/spec/engine/` page headings and a repo-wide E-id census. Verified independently: 99 E-ids present, 33 gaps, 78 ids cited in 64 files, guardrails G5 at `:99`, the R-50…R-61 `docs/spec` line numbers (the evidence sheet's line numbers were off and were corrected), and the twelve Reawakened-guidance lines. Six open points (OPEN-1…OPEN-6) and the 3.27 boundary (OPEN-7) are recorded; plan is `draft` because the ticket is `hitl = true` and OPEN-1…OPEN-4 need the owner.
- 2026-10-15 — owner approved the plan and ruled OPEN-1 to OPEN-6 as proposed; OPEN-7 is unblocked because 3.27 merged (PR 62). The entry's `verify` was amended to the 99 existing E-ids. The plan is `ready-for-dev`.

## Design Notes

Order of work: the census and the anchors first (they are the acceptance test), then the mechanical E-id paragraphs, then the Reawakened-rule blocks (guidance #1…#12), then the R-50…R-61 conflict blocks (both sides quoted), then the new `parity-checklist.md` and its README row. The ticket carries `hitl = true`: nothing migrates before the human has approved this plan and ruled OPEN-1 to OPEN-4, and this plan stayed `draft` until the human approved it. The reconciliation note's section D is the source for the conflict rows and is never reproduced elsewhere as a second source of truth.

## Verification

**Commands:**
- `git rev-parse HEAD` then `git diff --stat` — expected: the commit touches only `docs/spec/engine/**` and `docs/spec/README.md`; `docs/format-spec.md` and `docs/engine-features.md` unchanged.
- `python3 -c "import re,glob; src=set(re.findall(r'E-(\d+)', open('docs/engine-features.md').read())); got=[]; [got.extend(re.findall(r'id=\"e-(\d+)\"', open(f).read())) for f in glob.glob('docs/spec/engine/*.md')]; print(len(src), len(got), sorted(set(got))==sorted(src), len(got)==len(set(got)))"` — expected: `99 99 True True` (every existing E-id exactly once, none invented).
- `grep -rn "Reawakened rule" docs/spec/engine/` — expected: at least the twelve guidance blocks.
- `grep -rn "R-5[0-9]\|R-6[01]" docs/spec/engine/` — expected: each of R-50…R-61 recorded once on its owning page.
- `pnpm provenance && pnpm licence` — expected: pass (docs-only change).

**Manual checks:**
- Read each R-50…R-61 block beside the matrix above and confirm both sides are quoted with the citations in this plan.
- Read `docs/spec/engine/parity-checklist.md` against `docs/engine-features.md:363-377` and confirm the table is complete and `docs/guardrails.md:99`'s reference now resolves.
- Follow every relative link added to the engine pages.
