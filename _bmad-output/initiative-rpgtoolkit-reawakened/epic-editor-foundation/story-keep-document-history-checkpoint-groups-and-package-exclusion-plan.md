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
