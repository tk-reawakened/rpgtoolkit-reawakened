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
- Desktop input/parity and Android proofs were not run (no device or emulator here); `golden:bun` was run separately.
- At `1e2343a82c`, the serial `pnpm editor:acceptance` run passed all ten gates. Focused verification of the same implementation passed in script-tools (14), LSP (8), editor-model (27), editor-ui (7), cross-host (5), and the standalone Monaco Playwright proof (1). The native acceptance suite is foundation coverage, not a full native UI proof of all four new workflows.
- After the review hardening, a complete serial `pnpm editor:acceptance` passed all **11** lanes, including both Monaco cases and the new real VS Code web workflow lane. `pnpm typecheck`, `pnpm lint`, `pnpm test:strict` (5825 passed; no skips), `pnpm graph`, `pnpm script:dogfood`, command docs, help-content and ADR numbering also passed. Focused checks of the final recovery ownership and lexer changes passed (31 editor-model and 15 script-tools cases); the exact snapshot binding and cross-host checks passed (8 and 6).
- The standalone native proof was rebuilt and passed again at implementation commit `5eb7f368e3127303eaff4c04a476a17087184323`.
- For the final review fixes (`e2574bb9ab52d5643d9935648a9e6af574fb43ea`), the complete serial `pnpm editor:acceptance` passed all 11 lanes. Both Monaco cases passed, including the real palette-shortcut/Escape regression. Native VS Code actually replaced the selected `.gam` with a Toolkit 2 main while checkpoint consent was open; it reported the refusal and kept the program's original bytes. The 50 focused tests, `test:strict` (5831 passed; no skips), typecheck, lint, graph, script dogfood, command docs, generated help and ADR numbering passed.

## Review status

Draft PR #3363 requires independent review and CI before merge. No owner approval is claimed for the implementation choices below.

- **#3399 — batch recovery and live write checks.** A single `before-script` capture publishes all prior and review-approved result bytes before the first write. It is restore-only; a fresh script apply requires a live review. The restart regression interrupts staging between content records, then interrupts a two-file apply before its first receipt. It verifies no partial manifest, no retry, no deletion of an unreceipted new copy, and no overwrite of external edits. Model regressions cover source bytes, open source text, open destinations and a project switch during confirmation. Both hosts resolve live buffers and check immediately before delegating the write; this is not a cross-file filesystem transaction.
- **#3398 — snapshot identity.** Both transports finish sending the snapshot before forwarding the bound main URI and revision. The server rejects a mismatched, stale, or failed generation without waiting for a future notification. The server tests interleave two mains with different dialects under one root; the native proof switches to the legacy main in the same nested percent-bearing folder.
- **#3406 — fresh native command palette.** The reviewed commands are available without an open program. The actual VS Code web proof drives all four commands and checks native diff, Cancel, opt-out, confirmed disk write, an unsaved editor change followed by manual Save, cleanup fragment evidence, and a migration copy that preserves its original. Both host proofs are included in `pnpm editor:acceptance`.
- **#3407 — cleanup fragments.** The lexer-compatible scan reports legacy prefixes following an inline star comment, a quote inside a block comment, or the ignored tail of an include directive.
- **#3418 and #3421 — main bytes and exact path identity.** Same-path changes to the selected main invalidate the reviewed dialect before either a buffer edit or a write, even if the host still reports the same selection. Case-colliding programs are not bound to the same open buffer. Migration paths and recovery records never target differently spelled aliases.
- **#3417 and #3420 — report the write and its recovery independently.** A failed recovery receipt is a warning on an applied file, never an unapplied write the user could retry. History reports an edited existing file as kept and reserves the explicit delete override for uncertain new copies.
- **#3419 and #3422 — modal ownership and compiled exclusion.** The browser workbench is inert while the review is open, including its window-level command palette shortcut. The saved compiled marker wins over a native text override.
- **#3423 — page shortcuts.** The browser page's own save and undo dispatch respects the active review. The actual Monaco proof presses both shortcuts with an unsaved program open, cancels the review, and confirms the edit and disk bytes were untouched. An ordinary save afterward writes the same edit.
- **#3424 — link swaps.** The filesystem check rejects links in any source or destination component. Deterministic tests insert a directory link while consent is open and a same-byte file link during final readback; neither reaches a target write, and the directory link also prevents creating folders.
- **#3425 — partial group restore.** History records a renamed path as kept, continues to restore the unaffected program and keeps the refusal durable when reversing the restore, even if the original spelling becomes available again.
- **#3400 — intermittent native quick-open proof, not resolved here.** An earlier `editor:acceptance` timed out submitting the path after the prompt appeared. The unsubstantiated palette-chord retry was removed; the cause of the after-fill prompt loss is not established.

## Defect filed

#3364 tracks the reported review overlay loss. The script review now mounts outside the shell and only its own callback may tear it down; this does not establish the cause of other workbench dialogs disappearing.
