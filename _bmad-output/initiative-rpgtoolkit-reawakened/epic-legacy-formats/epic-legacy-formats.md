---
type: epic
title: "Legacy projects load: formats, packages and asset resolver"
parent: initiative-rpgtoolkit-reawakened
covers: ["CAP-1"]
assignee: ""
risk: medium
status: done
tracker_id: "#911"
remote: "https://github.com/tk-reawakened/rpgtoolkit-reawakened/issues/911"
---

# Legacy projects load: formats, packages and asset resolver

## Description

Every file format in the legacy sample games parses in pure TypeScript from bytes, from a folder, a `.tpk` or an appended-ZIP EXE, through a case-insensitive asset resolver, images decode once to RGBA (`decodeTexture`), the project's own distribution package (a `.tpk`-compatible ZIP with `manifest.json`) reads and writes, and pre-vector boards upgrade to the vector model. Every reader implements the pluggable `AssetDecoder` interface (AD-31) registered through the core format registry. A headless dump tool prints each file.

## Outcome

Legacy authors and the engine can open any file of a legacy project; the CAP-1 success check, a dump and round-trip of every sample-game file, is the signal.

## Done when

1. The dump tool parses every file in `demo` and `Basic` without error and prints it as readable data.
2. Formats the project writes round-trip as `docs/spec/formats/` states, byte-for-byte or semantically.
3. A `.tpk` and an appended-ZIP EXE load to the same project as the extracted folder, and path lookup is case-insensitive.
4. A pre-vector board converts to vectors, programs, shading and pixel positions as `docs/spec/formats/legacy/older-binary-versions.md#board-minor-2-and-3-pre-vector` states.
5. The distribution package round-trips with its manifest, and `decodeTexture` returns identical RGBA for every sample-game image. The core package still builds with no DOM or Node types (G2), imports only `fflate/browser` with sync APIs, and cites the `docs/spec/` page and anchor each reader implements.

## Boundaries

Byte readers and writers, the asset resolver, package import and pre-vector upgrade, all in `core`. Not the editor's use of them, not rendering, and not the optional formats compiled `.prg` and legacy `.sav` pending the open questions. The Toolkit 2 (2.x) text-era formats are epic tk2-support's (decision 2026-10-11). The upgrade logic of T-31 is built here and reused by the editor later.

## References

- spec - _bmad-output/initiative-rpgtoolkit-reawakened/spec-rpgtoolkit-reawakened/spec-rpgtoolkit-reawakened.md, section Capabilities
- spine - _bmad-output/initiative-rpgtoolkit-reawakened/architecture-rpgtoolkit-reawakened/architecture-rpgtoolkit-reawakened.md, AD-5, AD-6, AD-18, AD-28, AD-31
- constraint - `docs/spec/formats/README.md#header-and-version`-13
- reference - docs/spec/engine/main-loop-and-startup.md#e-01, E-10, E-130, E-131

## Notes

- Decision: Jensen, 2026-10-11: 2.x text boards and the other text-era formats are supported, so TK2 games load. Their readers are epic tk2-support's (it builds on entries 2.13 and 2.14 of this epic); this epic's readers refuse them with a clear message until then. Compiled `.prg` and legacy `.sav` stay open questions.
- Decision: Jensen, 2026-10-11: the review deferrals of entries 1 to 12 became entries 15 to 22; the closing sweep (14) waits on them.
- Unknown: the exact legacy `Basic` and `demo` file versions present; discover at inception.
- Decision: epic set approved by the user, 2026-10-10.
- Waits on platform-baseline because: the monorepo, CI and fixture fetch.
- Open question: the JPEG decoder (library under the allowlist, or hand-written) and resource limits for untrusted packages are chosen in this epic.
- Decision: envelope re-sliced against the architecture spine, 2026-10-10.
- Decision: entry 13 added 2026-10-11, approved by the user. The `AssetDecoder` interface of AD-31 and the core format registry that this Description names were never sliced, because the Description gained that sentence after the breakdown (commit e2f4fd7). Entry 13 builds them; entries 1 to 12 stay done.
- Assumption: entry 13 keeps the rules the dump already follows. `.brd` has one decoder that peeks the minor (a vector board, or a pre-vector board converted to the vector model). Only the dump's data-format rows move onto the registry; its skip reasons (`.prg`, `.gph`, `.tan`, `.tbm`, `.sav`, media, unrecognised files) stay in the dump. The decode context that AD-31 calls `AssetResolver` is a new type over the landed `AssetIndex` and `AssetRoot`.
- Source conflict: AD-31 — decoders register through `PluginDefinition.decoders` (ADR 0004) vs ADR 0004 — `PluginDefinition` has `id`, `version`, `commands` and `subsystems`, and no `decoders` field. The Decision below settles it for this epic; the two documents still disagree until the plugin work amends one of them.
- Decision: plugin registration of decoders is not part of this epic (the user, 2026-10-11). Entry 13 builds the `AssetDecoder` interface and the core format registry only. The `decoders` field and its wiring belong with the plugin mechanism, whose API is an open question of epic rpgcode-vm (E-99).
- Decision: entry 14, the closing Refactor sweep, added 2026-10-11 at the user's request, so the epic ends with the cleanup story the ticket tool expects. It waits on entries 1 to 13.
- Decision: Jensen, 2026-10-15: `docs/spec/` replaces `docs/format-spec.md` and `docs/engine-features.md` as the normative spec (ADR 0007, entry 1.13); the owner attests it is clean (extraction-log round 4).
- Decision: 2026-10-15: entries 23 to 26 added: migrate §1–§14 into docs/spec/formats and rule R-01 to R-16 and R-25 (23), align the readers and dump (24), a `.tbm` reader and writer, which no entry owned (25), and the committed docs/spec/examples corpus in the dump gate (26). The sweep (14) waits on them. Source: discovery/docs-spec-reconciliation.md, section A.
- Evidence: 2026-10-15: on the 3.1 sample corpus our dump and docs/spec/tools/rpgtk_formats.py agree on every file (40 binary files parse exactly), so no current binary layout conflicts on real data; the conflicts are in meanings, rules and the 8-bit palette (236 of 256 entries differ, R-01).
- Evidence: docs/spec/examples/files holds the repo's first real `.tpk` and `CMP1` standalone EXE; both load to the same tree as the folder (R-08). §13.2's "no sample ships a package" is out of date.
- Open question: R-06, the index scripts see for board items after an empty slot (legacy compacts, our reader keeps slots), is ruled by board-rendering or movement-triggers at inception; the reader keeps raw slots either way.
- Decision: Jensen, 2026-10-15: R-01 — 8-bit tiles use the `docs/spec/formats/dos-palette.json` table, replacing the standard VGA table in `vga-palette.ts` (entry 24).
