---
type: feature
title: "Keep document history, checkpoint groups and package exclusion"
ticket: 14
status: built
---

## Scope

Implement [ADR 0022](../../../docs/adr/0022-shared-editor-authoring-contracts.md#d12--history-and-checkpoint-groups) D12 in shared code on top of `fs`: a per-document history entry for every successful save (reason, time, SHA-256 content hash, checkpoint group id), checkpoint groups that record every touched document before the first write, named project checkpoints, the document and project timelines with read-only preview and restore, and the reserved in-project folder with its ignore offer. The first task is one measured editing hour: count accepted-edit gestures per hour through the 11.2/11.3 tracer (or a scripted board-painting hour that calls `writeBoard` on a corpus board) and derive entries per hour for 10, 60 and 300 s merge windows, so the retention floors and the autosave merge window are set from the resulting MB/day rather than guessed. D12.8 fixes the structure, not the numbers.

The package exclusion is part of this story: `docs/spec/formats/packaging-and-paths.md` says a package holds every file under the project folder and its "Not included" row names only `Saved\`, so the table and the exporter both need the history folder (and, with 12.9, test-only files) named and checked. Record the measured numbers in ADR 0022 D12.8 as part of the change.

## Acceptance

History is the same in every host, survives a host change with the project, and never appears in a produced package; autosave cannot destroy the previous version; a multi-document operation is recoverable as one action with an honest per-file report; nothing promises cross-document atomicity and no delta format is invented in the first release.

## Verification

One measured editing hour's entry counts set the merge window and the retention floors, and the numbers are recorded in ADR 0022 D12.8; a multi-file wizard operation restores to its pre-operation content as one group and reports each file separately; a restore is itself restorable; a produced package contains neither the history folder nor test-only files, and the exporter check fails when either is present.

## Decisions and prerequisites

ADR 0022 D12 is accepted (owner approval, 2026-11-09): in-project folder confirmed, retention numbers deliberately unset until measured, and autosave and retention are user-only settings entries (D6.3). VS Code's own Timeline keeps working beside it.

This story is on epic 11's closing path: it is a prerequisite of the refactor sweep (11.12) and the closing acceptance (11.13), because the foundation cannot claim to close while an accepted host-independent store is unbuilt. Flagged for the owner in the PR that allocated it; the epic envelope's Done-when says nothing about history and was left unchanged.

Prerequisites: 11.1, 11.3, 11.5.

## Implementation receipts

Implementation is built; merge/closure still awaits independent exact-head review and required CI.

- `pnpm run typecheck:tests` from `tools/editor-vscode-test`: passed after the final browser-test edit.
- `pnpm run browser:build && pnpm exec playwright test tools/browser/tests/editor-history.spec.ts tools/browser/tests/editor-web-host.spec.ts --grep 'history is kept|browser workbench creates a new project' --workers=1`: the History case passed. The New Project assertion was corrected to validate the immutable pending capture manifest and latest append-only progress record separately.
- `pnpm run browser:build && pnpm exec playwright test tools/browser/tests/editor-web-host.spec.ts --grep 'browser workbench creates a new project' --workers=1`: passed, 1 test; validates the created wizard group, all written paths, progress-backed content hashes, actual project bytes, and unchanged bystander bytes.
- `TKR_VSCODE_HISTORY_PROOF=1 TKR_VSCODE_SKIP_SPRITE_PROOF=1 pnpm --dir tools/editor-vscode-test proof -- --extension extensions/editor --workspace docs/spec/examples/game --game Main/example.gam`: passed in 95.85s, with the real VS Code web workbench. Covers GAM settings, Board, tileset art and Bitmap history preview/restore/undo, correlated asset RPCs, group restore and byte checks, read-only rejection, native editor-close/reopen refusal flow, and real New Project group/picker/creation.
- Earlier full browser evidence artifact #1353 remains the original 123/125 run; it was not rerun. Its two failures have evidence-backed follow-up issues #2859 and #2884.
- Post-review fixes for #2885–#2890 cover custom/native restore lifecycle and editor undo/save tracking, native text save/restore tracking, the pre-confirmation byte revision guard, physical history usage accounting, correlated animation preview denial, and canonical recovery-group access. Focused History tests passed 42/42 with zero skips; `pnpm run test:strict` passed 5022/5022 with zero skips; `pnpm --dir tools/editor-vscode-test typecheck:tests` and `pnpm run lint` passed. Independent review of the updated exact head and required CI remain pending.
- Checkpoint `18c35a981c98e03dfaf4df024119ff2de7107281` is pushed. After the source review fixes, focused History tests passed 43/43, `typecheck:tests`, `pnpm graph`, lint, and `pnpm run test:strict` passed at the earlier checkpoint; the current browser-test instrumentation typecheck and proof-filesystem tests also pass.
- The previously passing 95.85s native proof and 5022/5022 strict run are historical receipts at `a7a2`, not current-head proof. The first instrumented `#2904` run captured the exact open and active resource `tkr-testfs://…/Main/example.gam`, selected tab `example.gam`, a unique writable settings frame, and an exact `/Main/example.gam` `save-request`; no `saveCustomDocument` callback was entered within 5s, and the run stopped before checking bytes. An earlier actual run waited 30s and observed the backing GAM remained unchanged. The issue remains open; no production save workaround or weakened byte assertion is accepted.
- The latest corrected History/New Project workbench attempt used the production placeholder `Restore a saved version or recovery group` (the previous proof locator used a stale label; fixed in four call sites and issue #2908 filed). It passed 10/10 proof filesystem/setup tests, VS Code web autosave negative control, and the Board/art/Bitmap stage. Native `.prg` Ctrl+S changed backing bytes and its saved-history hash checks passed; the delayed-read race then stopped at the explicit restore confirmation, before the proof accepted it or exercised apply, and observed a guard toast for open `Main/Quest.gam`. This is an incomplete race proof, not a passing native restore-race receipt; revise the scenario to confirm the real dialog and isolate the competing open-document guard before another workbench run.
- `pnpm --dir extensions/editor build`, focused editor-model tests (36/36), persistent filesystem tests (6/6), `pnpm --dir tools/editor-vscode-test typecheck:tests`, and `pnpm exec tsc -b packages/editor-model packages/host-vscode` passed in the current source slice. The browser proof was not green, and there is no current exact-head full strict/static/G5/CI receipt.
- Issue #2896 remains a true contract blocker: the VS Code native `onWillSaveTextDocument` rejection is not a save veto; the user is now told truthfully that VS Code may still save when history capture fails. D12.10.4 still requires fail-closed behavior, so this story cannot be called complete or PR-ready without an owner ruling or supported host capability. Do not edit ADR 0022 or weaken its accepted contract without that ruling.
