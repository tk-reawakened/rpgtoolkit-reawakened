---
type: feature
title: "Complete document lifecycle and host conformance"
ticket: 3
status: built
---

## Scope

Extend 11.2 controller and host adapters without duplicating document identity; cover canceled close, failed writes, backup availability, external modification and explicit resolution.

## Acceptance

Each edit has stable identity; view switching and hidden webviews do not lose state; save failures and conflicts retain local work and truthful host capability reporting.

## Verification

The same conformance suite exercises undo and redo by editId, save timing, conflict and recovery behavior on web and VS Code including hidden views and one model per URI.

## Decisions and prerequisites

Conformance follows 11.1; no promise of cross-document atomicity or universal durable backup.

Prerequisites: 11.2.

## What was built

- **`platform-services`** gains the `dialogs` surface (AD-20) against its first real callers: `ask` with a fixed set of
  answers and a `cancel`, and `pickSavePath`. Capabilities gain `backup`, so a host that keeps hot-exit backups is
  distinguishable from one that does not. The in-memory double answers questions and save paths from a script, and fails
  a call whose answer the question does not offer.
- **`editor-model`** owns the whole lifecycle. A document compares the file with what it last read or wrote before
  writing (D11.3): another program's change is never saved over, the save fails with `kind: "conflict"`, and the change
  waits in the snapshot until `resolveConflict("keep-local" | "reload")`. `checkExternal` lets a watching host follow the
  file: a clean document reloads (nothing local is lost), a dirty one raises the conflict. `revert` returns to the saved
  revision with the history before it kept, or reloads a changed file with a new history, and refuses when an edit was
  accepted after the caller asked (so a question answered "revert" never discards work typed meanwhile). `saveAs` writes
  a copy to a new identity without re-keying the source. `createDocumentWorkspace` is the host-neutral workbench: one
  model per identity, case-resolved paths (two names differing only in case are refused and both named, D1.2), undo and
  redo by `editId`, save all with a result per document, close and revert that ask first, Save As with the destination
  and collision settled before writing, and a file watch where the host declares one.
- **`editor-ui`** shows a change on disk beside the local title (both titles, "Save my version" and "Use the version on
  disk"), says when the host cannot watch files, and follows the document's title after a revert.
- **`host-web`** is that workspace plus a page `dialogs` implementation; the page's toolbar drives undo, redo, Save as,
  Save all, Revert and Close, opening another game closes the current document through the same question, and leaving the
  page asks the browser while work is unsaved. It declares `folderWrite` and `stableProjectHandle` only.
- **`host-vscode`** splits into a `vscode`-free provider core (`custom-editor.ts`) and the API binding. Save As and revert
  are implemented instead of refused, the workbench's save result is the provider's own (`#2092`), a recovered hot-exit
  backup is opened over the file as it is now so its save cannot conflict with itself, and capabilities name `backup`
  always, `fileWatch` on the desktop build only.
- **One conformance suite** (`tools/editor-vscode-test/conformance/`): thirteen cases written once against a small host
  interface, run against the browser host, VS Code desktop and VS Code for the Web — the last two through a workbench
  driver that follows VS Code's custom-editor contract. 39 tests, each under 150 ms.
- **Real hosts:** `tools/browser/tests/editor-lifecycle.spec.ts` drives the browser page's own controls, and the vscode.dev
  proof gains the hidden-webview, cancelled-close and D11.6 autosave scenarios.

## Verification

- `pnpm test` (all package tests plus the conformance suite), `pnpm typecheck`, `pnpm lint`, `pnpm graph`, `pnpm licence`,
  `pnpm provenance`, `pnpm editor-ui-toolchain:check`, `pnpm browser:test`, and the vscode.dev proof in the browser lane.
- Every new evidence test was perturbed: the guarded behaviour was broken, the test observed to fail for the claimed
  reason, and the behaviour restored. The perturbations and both outcomes are recorded in the pull request.
