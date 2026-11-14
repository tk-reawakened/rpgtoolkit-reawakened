---
id: 21
type: bug
title: "Preserve VS Code web proof files across workbench restarts"
parent: epic-editor-foundation
covers: [CAP-15, CAP-18, T-06]
after: [3]
refined: true
hitl: false
risk: high
severity: P2
---

# Preserve VS Code web proof files across workbench restarts

## Description

The VS Code web proof loses saved fixture writes when the extension host restarts, preventing a real-workbench proof of external changes while closed. The test harness must preserve workspace bytes across restarts without implying anything about production filesystem providers.

## Reproduction

1. Run the existing VS Code web workbench proof using `@vscode/test-web@0.0.81`.
2. Edit the game title, save it, and observe the saved bytes in the workspace.
3. Reload the workbench and read the file through `workspace.fs`.
4. The provider returns the original fixture instead of the saved bytes. The expected result is the exact saved content after restart.

## Cause Hypothesis

The test-web filesystem provider stores writes in memory and reconstructs its root when the extension host restarts. This is a test harness limitation, not a claim about production VS Code filesystems.

## Acceptance Criteria

1. **Saved bytes survive a real restart.** Given a test-only persistent workspace, when the web workbench saves a document, stops and restarts, then an independent backing-store read and `workspace.fs` both return the exact saved bytes.
2. **An offline external change remains distinct.** Given a dirty local revision and a confirmed durable backup, when the workbench stops, the backing file is independently changed during the stopped interval, and the workbench restarts, then the recovered editor remains dirty with the local revision and an independent read confirms the exact external revision remains on disk.
3. **Both conflict choices preserve data.** Given independent recovered-conflict cases, when the user chooses Cancel or Keep, then the recovered local content remains visible and dirty and the exact external bytes remain in the backing store. Only an explicit later save of the intended document may replace those bytes; reopening confirms the resulting bytes.
4. **Other documents are safe.** Given a second unrelated dirty editor, when either conflict choice is exercised, then its content, dirty state and backing bytes remain unchanged. Capture command dispatch at the extension/host boundary, separating expected harness and workbench commands from recovery-triggered untargeted Save or Revert.
5. **Regression proof.** Given the real-workbench test, when persistence or the independent offline change is removed, then the relevant assertions fail. No implementation change is needed only if the current proof already passes the same independent persistence, offline-change and recovery observations; record that evidence.

## References

- parent — _bmad-output/initiative-rpgtoolkit-reawakened/epic-editor-foundation/epic-editor-foundation.md
- issue — https://github.com/tk-reawakened/rpgtoolkit-reawakened/issues/2246
- decision — docs/adr/0022-shared-editor-authoring-contracts.md#d14-2-conflict-resolution
- feature — docs/editor-features.md, T-06

## Notes

- Risk: high because a false proof could conceal loss of recovered edits. Run the shared host conformance suite in `tools/editor-vscode-test/test/host-conformance.test.ts` as an additional check.
- Open question: establish observable backup completion and restart sequencing during the work; neither recovery acceptance nor completion can be claimed without that evidence.
