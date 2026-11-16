---
id: 3
type: bug
title: "Document history loses its file context after opening a history preview"
parent: none
covers: []
after: []
tracker_id: "#2856"
remote: "https://github.com/tk-reawakened/rpgtoolkit-reawakened/issues/2856"
assignee: ""
refined: false
hitl: false
risk: medium
severity: P2
---

# Document history loses its file context after opening a history preview

## Description

After a user restores a saved version, the History preview becomes the active editor tab. Running Document history again reports that there is no history, even though saved versions still exist for the restored game file. The command should continue to show history for the document that was restored, or otherwise keep the user in the same document context.

## Reproduction

1. In the native VS Code workbench, open a game file from a project nested below the workspace root.
2. Change and save the game file twice so the project contains multiple history entries.
3. Run `RPG Toolkit: Document history` and choose an earlier saved version.
4. Leave the resulting `History preview` tab selected and run `RPG Toolkit: Document history` again.
5. Actual: the workbench reports `No history yet. Save a document and it is kept in .tkr-history/.` The persisted `.tkr-history/entries/` records still contain the game file's checkpoint and two manual entries, with different SHA-256 values, and the first restore changed the actual game file bytes.
6. Expected: the command still offers the restored game's timeline and allows the restore to be undone.

## Cause Hypothesis

The native command resolves history from the active custom-editor tab URI. A history preview opens a separate webview tab, which has no custom-editor URI. The command then loses the original document identity and selects a different history scope.

## Acceptance Criteria

1. **The restored document's timeline remains available**
   **Given** a native custom editor with at least two saved versions
   **When** the user restores one version, leaves its preview selected, and runs Document history again
   **Then** the command offers that document's saved timeline and the user can restore the version created before the first restore
2. **The regression has real host coverage**
   **Given** the native workbench proof
   **When** it runs against the production extension and persistent proof filesystem
   **Then** it checks the visible History command result and the actual persisted entry and file bytes through the complete restore-of-restore flow
3. **Or: no change is needed, with proof**
   **Given** the reproduction
   **When** it is run on the current code
   **Then** the second command offers the restored document's timeline, or the report is mistaken, with the evidence recorded in Notes — this supersedes 1 and 2

## References

- source — `packages/host-vscode/src/history-command.ts`, active-document history selection
- source — `packages/host-vscode/src/extension.ts`, native History command adapter
- proof — `tools/editor-vscode-test/web-proof.ts`, native New Project and History proof
