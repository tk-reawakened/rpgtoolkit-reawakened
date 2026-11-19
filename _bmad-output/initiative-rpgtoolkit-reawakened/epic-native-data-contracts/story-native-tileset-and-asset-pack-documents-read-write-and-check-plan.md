---
title: 'Native tileset and asset-pack documents read, write and check'
type: 'feature'
ticket: 13
created: '2026-11-18'
status: 'done'
baseline_revision: '65611327311a59aa5cb9da0c52231319b51134cc'
route: 'full'
route_source: 'auto'
risk: 'high'
review: ''
review_source: ''
lenses_ran: []
review_loop_iteration: 0
context: []
---

<frozen-after-approval reason="owner delegated recommended implementation choices for autonomous Epic 12 work">

## Intent

Creators and tools need to read, validate and edit native tilesets and asset packs without losing comments or plugin data. Implement both contract readers/writers and checker/rename integration against the current pre-release specifications, following the existing clip workflow.

## Boundaries & Constraints

**Always:** Follow `docs/spec/formats/native-tileset.md`, `native-asset-pack.md`, `native-contracts.md` and the existing clip preservation contract. Keep source-backed edits as splices, preserve plugin blocks and unrelated comments byte for byte, validate closed core shape and local references, and update native document path references on rename. Keep optional fields absent where the contracts require it. Report a missing reference rather than silently replacing it.

**Never:** Consult legacy source, implement runtime loading, art/scene lowering, or migrate games. Do not invent plugin-local schemas or regenerate unowned plugin bytes. Do not claim personal approval of the tileset contract when none is recorded.

## I/O & Edge-Case Matrix

| Scenario | Input | Expected | Failure handling |
|---|---|---|---|
| Read and write | Authored tileset or pack with comments and plugin block | Source-backed write returns identical bytes | Refuse if preservation cannot be guaranteed |
| Edit collision | Valid tileset with tile collision | One property changes; unrelated text and plugin bytes remain intact | Located error for invalid path/value |
| Invalid document | Wrong stamp, unknown field, bad local or document reference | Checker identifies document and problem | Never repair automatically |
| Rename | Move referenced native tileset or pack | Reference path is updated, plugin content unchanged, checker remains clean | Report collisions or invalid destinations |

</frozen-after-approval>

## Code Map

- `packages/native-data/src/clip.ts`: existing `readClip`, `writeClip`, `setClipProperty`, shape validation and in-place splice precedent. Reuse shared document and plugin validators rather than inventing a second plugin contract.
- `packages/native-data/src/document.ts`, `plugin-data.ts`, `splice.ts`: stamp parsing, opaque block validation and text-edit primitives.
- `packages/native-data/src/check.ts`, `report.ts`, `rename.ts`, `index.ts`: integrate new document checking, structured reports, native reference paths and public exports without disturbing clip behavior.
- `docs/spec/formats/native-tileset.md`, `native-asset-pack.md`: source of each field shape and validation, including source-local IDs, vector geometry, identity and path/local-ID references.
- `packages/native-data/test/clip.test.ts`, `check.test.ts`, `rename.test.ts`: behavior and fixture conventions for comment-preserving edits and checker/rename proofs.

## Tasks & Acceptance

- [x] Implement tileset reader, writer, checker and in-place field edit with focused authored tests.
- [x] Implement asset-pack reader, writer, checker and in-place field edit with focused authored tests.
- [x] Integrate both contracts into package exports, project checking and rename, including references in consumer documents.
- [x] Given authored valid fixtures, read/write retains bytes and a collision edit changes only its authored value; unknown core keys fail while plugin payload survives.
- [x] Given bad fixtures, checker names stamp, identity and reference errors, including missing source images and invalid crop/cell bounds (#3202); renaming a referenced pack or tileset keeps the checker clean and does not edit plugin blocks.
- [x] Complete independent review and address practical blockers before publishing.

## Implementation Notes

Implemented source-preserving tileset and pack documents and nested scene art reference checking/rename. The host now supplies decoded source-image sizes to the project-level checker, which reports missing images and out-of-bounds cells and crops (#3202).
- Review: fixed the plugin-block edit boundary, normalized and safely quoted nested rename paths, and rejected incomplete native art references (#3201).

## Plan Change Log

## Review Triage Log
- Review of image checking found host-case-dependent paths and references escaping the project. Component-wise ASCII-folded lookup now resolves real project files without scanning the whole tree, and refuses parent traversal (#3202).
- The proposed scene contract intentionally omits the earlier `things[].fromAsset` sketch; its supported pack references are `placedPacks[].pack`. No current scene contract requires the omitted location.

## Verification

Native-data and checker CLI suites: 193 passed, no skips; affected package builds and test typechecks, targeted lint, provenance (1,738 files, zero violations), and ticket-store validation passed. All new tests reported under one second. The tests prove missing images and out-of-bounds regions are reported, and simultaneous document renames preserve plugin payload bytes.
- After the lookup review fixes, 20 targeted CLI and project-art tests passed, including mixed-case filenames and an external sibling image; the CLI build, test typecheck and targeted lint passed.
- #3204 was approved and merged; #1848 was closed after mapping the acceptance criteria to the tests above and the passing CI gates.

Run the affected native-data tests, package test typecheck, repository lint and provenance. Inspect per-test durations and verify a reprinting writer would fail the byte-preservation proof. Record the contract approval status separately from implementation verification.
