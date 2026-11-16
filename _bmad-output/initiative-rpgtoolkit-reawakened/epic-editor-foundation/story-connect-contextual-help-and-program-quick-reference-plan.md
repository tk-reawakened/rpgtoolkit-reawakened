---
title: 'Connect contextual help and program quick reference'
type: 'feature'
ticket: '11'
created: '2026-11-15'
status: 'in-review'
baseline_revision: '3e61f3c2aedd2cd86dc0c29b5ebd750f5708f7bf'
route: 'full'
route_source: 'pinned'
risk: 'medium'
review: ''
review_source: ''
lenses_ran: []
review_loop_iteration: 0
context: ['docs/guardrails.md', 'docs/spec/engine/rpgcode-tooling.md']
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Creators need help that is reachable from the workspace and relevant settings, while writing RPGCode help that is accurate and usable without leaving the active program.

**Approach:** Connect existing help/reference content to workspace commands and settings, providing searchable built-in documentation and insertion while preserving each host's document ownership.

## Boundaries & Constraints

**Always:** Use existing manual and generated command documentation; use plain-language-first descriptions; open external destinations safely; return focus to the invoking control; support keyboard-only use in both browser and native VS Code.

**Never:** Invent missing documentation, ship an obsolete embedded browser, replace the VS Code `TextDocument` or create a competing Monaco undo/document model. Tutorial and tip-of-day presentation belong to Epic 14; preference toggle belongs to 11.5.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Program reference insert | Active editable program and selected documented built-in | Replace selection with documented invocation; focus returns to program and parameters are selected | Read-only state disables insertion |
| Documentation unavailable | Missing manual or what's-new destination | Identify it as unavailable; do not fabricate content or dead link | Keep editor usable and report unavailable target |
| External manual link | User activates documented external destination | Host opens only the validated external URL through its safe service | Rejected or unavailable URL produces an accessible message |

</frozen-after-approval>

## Code Map

- `packages/editor-ui/src/program-view.tsx` already filters the shared `commandReference()`, displays documented syntax/summary, and inserts through `insertCommandEdit`; insertion currently depends on the editor surface selection and needs consistent keyboard/focus behavior.
- `packages/editor-model/src/program-support.ts` owns `CommandReferenceEntry`, the catalogue projection, filtering, and insertion semantics. Reuse it; do not add a second catalogue.
- `packages/editor-ui/src/command-palette.tsx`, `shell.tsx`, and `workbench.tsx` provide the shared workspace Help menu/palette and focusable shell entry points.
- `packages/editor-ui/src/preferences-view.tsx` and `game-settings-form.tsx` render settings; add contextual help at existing field descriptions rather than duplicating settings definitions.
- `packages/host-vscode/src/program-commands.ts` adds native editor commands against VS Code's active `TextEditor`; preserve this as the only native editable document.
- `docs/editor-features.md#T-09` identifies HTML manual, RPGCode reference, and What's New as help destinations; it does not assert tutorial/tip delivery in this ticket.
- `docs/spec/engine/rpgcode-tooling.md#tool-10` normatively defines the generated reference and insertion behavior; use this as the source for exact syntax and summaries.

## Tasks & Acceptance

**Execution:**
- [x] `packages/editor-ui/src/command-palette.tsx` -- connect the shared reference, repository-sourced RPGCode authoring guide and current changelog in the workspace menu and searchable command palette; render documentation in a safe, focus-returning dialog.
- [x] `packages/editor-ui/src/program-view.tsx`, `program-view.css` -- make the reference entry descriptive and keyboard-operable; focus search on opening, insert through the shared document command and return focus to text/toggle.
- [x] `packages/host-vscode/src/program-commands.ts` -- verify native command-palette insertion in an actual VS Code host without creating a competing text document.
- [x] `packages/editor-ui/src/command-palette.tsx`, `help-document.tsx` -- F1 opens the focused settings field's existing accessible description and its authoritative editor/game-settings documentation link; help returns focus to the invoking field.
- [x] `packages/editor-ui/test/program-view.test.ts`, `packages/editor-ui/test/shell.test.ts`, `tools/browser/tests/editor-program.spec.ts` -- focused tests cover help content, safe links, field focus return and keyboard search/insertion; browser proof completed.

**Acceptance Criteria:**
- Given a keyboard-only creator editing a program in either host, when they open the reference, search for a built-in and insert it, then the exact documented invocation is inserted into the active document and focus returns with its required parameters selected.
- Given a creator on a settings field, when they invoke contextual help, then the field's available plain-language explanation and safe manual destination are reachable and focus returns to the field/workspace.
- Given the workspace Help menu or command palette, when a creator requests manual, What's New, or searchable RPGCode reference, then available content opens in the appropriate host and unavailable content is identified without fabricated documentation.
- Given VS Code native editing or browser Monaco editing, when contextual help or insertion is used, then text ownership and undo remain with the existing host-authoritative document.

## Implementation Notes

- The workspace Help menu and command palette route to the active program's generated quick reference; it reuses `commandReference()` and host-authoritative insertion. Opening focuses search, insertion returns focus to the text surface, and closing restores focus to the reference toggle.
- `tools/editor-ui-toolchain/generate-help-content.mjs` packages the TOOL-10 program-editing reference and the latest 12 entries from the repository's `CHANGELOG.md` Unreleased section into generated static help text. The renderer builds semantic DOM nodes from text, makes only HTTPS links to this repository clickable, and labels the authoring guide honestly as spec-derived rather than the legacy HTML manual.
- F1 on a focused editor-preference or game-setting input opens its already-rendered `aria-describedby` text plus the relevant maintained docs page. Native `<dialog>` provides modal keyboard behavior and returns focus to the field or command that opened it.
- Native VS Code web-host proof passed against the actual RPGCode companion extension and active native `TextDocument`: palette insertion/save, authoring guide and What's New documents, and focused `.gam` title-field F1 help/Escape focus return. The proof passed 8 harness tests and reported `vscode.dev fixture program proof passed`; no parallel document model was introduced.

## Plan Change Log
2026-11-15: Connected the existing program reference and generated authoring/release notes to the workspace menu and palette, and added settings-field F1 help across browser and native VS Code. The browser proof passed 127/127; native help/insertion proof passed, generated help was refreshed after rebasing, and the PR remains in review pending final CI/review.



## Review Triage Log

## Design Notes

Help content is an entry point, not a new documentation system: URLs and reference entries must be sourced from maintained/generated material. Host opening behavior crosses platform boundaries, so the shared UI requests a host capability and does not directly call browser or VS Code APIs.

## Verification

**Commands:**
- Focused editor UI and host tests -- expected: keyboard navigation, insertion, focus return, safe destination behavior.
- `pnpm typecheck` and `pnpm lint` -- expected: clean package boundaries and types.
- `pnpm browser:test` and `pnpm desktop:input` -- expected: existing browser and desktop input gates pass.
- Relevant `.github/workflows/ci.yml` checks and actual browser/native VS Code path proofs -- expected: results recorded; unavailable environment not claimed green.

**Observed results (feature-proof source; generated-help-only refresh was checked separately after rebasing):**
- `pnpm typecheck` -- passed.
- `pnpm lint` -- passed.
- `pnpm test` -- 4,966 passed, 0 failed, 0 skipped.
- `pnpm no-skips:test` -- 49 passed, 0 skipped (plain command after #2852 merged).
- `node --test packages/editor-ui/test/program-view.test.ts packages/editor-ui/test/shell.test.ts` -- 57 passed, 0 failed, 0 skipped.
- `pnpm editor-ui-toolchain:check` -- passed after refreshing generated What's New content from the rebased changelog.
- `pnpm browser:test` -- 127 passed, 0 failed (port 4181; real Monaco context-menu formatting and mirrored program reference insertion covered).
- Native VS Code web-host proof -- 8 harness tests passed; actual companion extension, insertion/save, docs popups, and field help/focus return passed.
- Perturbation evidence: removing the inserted parameter selection failed the reference test at selectionStart (`0 !== 5`); routing F1 to F12 failed the contextual-help assertion (`F1 is captured before the host handles it`). Both mutations were restored and their focused tests passed.
- `pnpm editor-ui-toolchain:check` remains the generated-content freshness guard; required GitHub CI for the refreshed artifact and this exact final head remains pending.
