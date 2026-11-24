---
type: feature
title: "Reviewed script formatting and migration workflows"
ticket: 16
status: built
risk: high
---

## Intent

Expose formatting, canonical case and project-wide pre-3.1 update and cleanup through reviewed per-file editor workflows backed by the existing language-tool providers.

## Scope and acceptance

Reuse 10.5 syntax code actions and 10.7 formatter, adding missing orchestration or provider coverage rather than another rewrite engine; include quoted strings and keys, comparisons, sigils, comments, # prefix and loose dialogue, with failure retention and review before apply.

## Verification

Across native VS Code and Monaco hosts, fixtures verify correct provider results, per-file opt-out, original/result diff, unsupported fragments, cancel and behaviour-preserving accepted changes.

## Dependencies and decisions

Prerequisites: 1, 11.3, 11.7, 10.5, 10.7. Apply the epic Notes, format specs, AD-18/19/20/22/29 and connected-authoring direction; T-42, T-43, T-44, T-46 map to CAP-16. Preserve version and residue, use the existing shared model and browser, and route host access through platform-services. Where provider or host capability is unavailable, preserve data and report the limitation; do not simulate it.

## What was built (2026-11-24)

Owner approval: nothing here claims a new owner ruling. Both points below are implementation choices that follow documents the owner already approved (`docs/spec/engine/rpgcode-dialects.md#reawakened-project-script-dialect`, `docs/spec/engine/rpgcode-language.md` LEX-6); had either needed a different contract, it would be written as a proposed ruling instead.

Lands in: `docs/spec/engine/rpgcode-tooling.md#tool-4` (separable jobs) and the new `#tool-11`; `docs/editor-features.md` T-42–T-46; `packages/script-tools/src/{format,fixes,transform}.ts`; `packages/lsp/src/{protocol,index}.ts`; `packages/editor-model/src/script-workflow.ts`; `packages/editor-ui/src/{script-workflow-view.tsx,script-workflow-diff.ts,mount.ts,shell.tsx}`; `packages/host-web/src/{workbench,index,language}.ts`; `packages/host-vscode/src/{script-workflow,script-commands,extension}.ts`; `extensions/rpgcode/src/{scriptTransform,extension,extension.browser,project}.ts`; `extensions/editor/package.json`.

- **One request, four transforms.** `rpgcode/scriptTransform` answers `format`, `canonical-case`, `update` and `cleanup` from the running project's dialect; the editor adds review and apply only, so there is no second rewrite engine. The formatter now takes `jobs`, so capitalisation-only is a real request rather than a special case.
- **What each transform may do** is the spec's table. `update` converts Toolkit 2.x and, in a 3.1 source, drops ignored sigils; `cleanup` runs those stages, then formatting, keeping each stage only when it is proved.
- **Implementation ruling (conforms to owner-approved specs; no new owner approval claimed) — Toolkit 2.x conversions are copies.** Applied at `.tkr-migrated/3.1/<path>`; the original is never written. Evidence: a TK2 project runs its programs through the 2.x frontend (docs/spec/engine/rpgcode-dialects.md#reawakened-project-script-dialect), so 3.1 text in place would be read by the wrong reader. Rejected: rewriting in place after the conversion proof, because that proof compares the original TK2 reading with the 3.1 reading, not the project's own dialect.
- **Implementation ruling (conforms to owner-approved LEX-6; no new owner approval claimed) — a 3.1 line beginning with `#` is reported, not rewritten.** The 3.1 lexer ignores such a line whole (LEX-6, docs/spec/engine/rpgcode-language.md), so removing the `#` would make dead code run. It is reported as `legacy-prefix-line`. The `#` prefix *is* removed by the Toolkit 2.x conversion, where it introduces a statement. Rejected: offering the removal per line "when proved", because the proof can only pass by deleting the statement, so the edit would silently empty a line.
- **Unassessed 3.1 edits** are offered only when the edit holds under both the 3.1 and the Toolkit 2.x reading (the TOOL-4 rule), and the spots that fail are named `reading-dependent` rather than silently skipped.
- **Failure retention:** a refused, failed or unapplied file keeps its bytes and is listed with the reason; an apply failure leaves the entry selected so a retry covers exactly it; a file that changed since the review is not written (`changed-since-review`); without a recordable recovery checkpoint nothing is written.
- **Open programs** are edited as one labelled, undoable edit and not saved by the workflow; the author's own save writes them.

## Evidence (local gates, 2026-11-24)

- Unit: script-tools 9, lsp 5 (in-memory and stdio), editor-model 11, editor-ui 6.
- Cross-host (`tools/editor-vscode-test/test/script-workflow-hosts.test.ts`, real in-process server): both hosts plan and apply the same bytes with the same opt-out; an open program is edited unsaved in the browser and written only by the author's save; VS Code applies one edit to an open document and no direct write; cancel in either host writes and records nothing; the VS Code list offers only programs that change with the comparison in each item.
- Real browser (`tools/browser/tests/editor-script-workflow.spec.ts`): the application menu opens Format (reviewed), the project scope is checked through the language worker, only the changing program is offered with its comparison, and Cancel leaves both files byte-identical with no recovery group.
- Gates observed green: `tsc -b`, `lint` (eslint + core deps), `test:strict` (5802 passed, no skips), `fixtures:author:check`, `fixtures:test`, `fixtures:check`, `golden`, `closing` (8/8), `script:dogfood`, `graph`, `licence`, `provenance`, `catalogue:check`, `command-docs:check`, `help-content --check` (regenerated once, deliberately), `build:outputs:check`, `adr:numbering:check`, `vscode-web:test`, editor-program browser spec.
- Not run: `editor-acceptance`, desktop input/parity and Android proofs (no device/emulator here); `golden:bun` run separately.

## Defect filed

#3364: a dialog mounted on the workbench element could be removed by a shell re-render (the review vanished mid-apply). The review now mounts on the page; the other workbench dialogs should follow.
