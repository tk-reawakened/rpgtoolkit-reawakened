---
id: 28
type: bug
title: "Connected-authoring undo proof races the editor's undo checkpoint in editor-web"
parent: none
covers: []
after: []
assignee: ""
tracker_id: "#3322"
remote: "https://github.com/tk-reawakened/rpgtoolkit-reawakened/issues/3322"
refined: true
hitl: false
risk: medium
severity: P2
---

# Connected-authoring undo proof races the editor's undo checkpoint in editor-web

## Description

`browser (editor-web)` failed in run 44954024960 on PR #3311 at `tools/browser/tests/editor-connected-authoring.spec.ts:44` (`browser connected authoring follows shared graphics and local programs into saved board and game runs`).

The proof inserts text, presses `ControlOrMeta+Z`, then expects the editor to contain the pre-insert first line. It received:

```
Expected substring: "mwin(\"CONNECTED STARTUP OLD\")"
Received string:    "12345// Start-up program: runs once before the first board.mwin(\"Welcome to the example game!\")wait()mwincls()"
Timeout: 5000ms
```

The received text is the untouched starter program with a typed `12345` prefix, so the undo had not reached the expected document within the settle window — the fixed 5-second text expectation outran the editor's undo checkpoint.

The failing job is https://github.com/tk-reawakened/rpgtoolkit-reawakened/actions/runs/44954024960/job/136998096386. Forty-nine other editor-web tests passed in the same run; `gh run rerun 44954024960 --failed` re-ran the job green and the PR's full check set is green at head `37dc8cba9`. The PR changed script `playergetpath`/`itemgetpath` destinations and no editor-web code. A green rerun alone is not proof.

## Reproduction

1. Run `browser (editor-web)` during a full editor-web spec run.
2. In the connected-authoring proof, type `12345` into the starter program, select all, insert the new text, and press `ControlOrMeta+Z`.
3. Actual: within the 5-second expectation the editor still shows the starter program with the typed prefix, and the proof fails.
4. Expected: the proof waits for the editor's own undo checkpoint (document version/undo state) and then observes the pre-insert text, and a real missing undo still fails.

## Cause Hypothesis

The proof waits for text rather than for the editor's undo state. When undo is applied asynchronously, the fixed 5-second expectation can expire before the editor publishes the undone document, so a transient scheduling delay is reported as a missing undo. The immediate green rerun and the absence of editor-web changes are consistent with a timing race, not a broken undo.

## Acceptance Criteria

1. **The proof waits on the editor's undo checkpoint**
   **Given** the connected-authoring proof inserting text and pressing undo
   **When** it checks the document
   **Then** it waits on the editor's own document version/undo state (or an equivalent deterministic checkpoint), not only a fixed 5-second text expectation
2. **A missing undo still fails**
   **Given** an undo that does not restore the earlier document
   **When** the proof waits
   **Then** it fails with the editor state, and the assertion is not weakened or skipped
3. **Repeated full-spec runs are stable**
   **Given** the fix
   **When** the complete editor-web spec runs repeatedly
   **Then** the connected-authoring test passes without relying on a lucky rerun

## References

- issue — https://github.com/tk-reawakened/rpgtoolkit-reawakened/issues/3322
- failing job — https://github.com/tk-reawakened/rpgtoolkit-reawakened/actions/runs/44954024960/job/136998096386
- spec — `tools/browser/tests/editor-connected-authoring.spec.ts` (test at line 44; undo expectation at line 176)
- proof — `tools/editor-vscode-test/connected-authoring-proof.ts` (`writeProgram`, the insert/undo block)
- related — issue #2857 / PR #2829 (History preview RPC and mount timing)

## Notes

- The failing PR changed `playergetpath`/`itemgetpath` destinations and no editor-web code, so this is recorded against the proof's timing, not that change.
- Do not simply lengthen the timeout; the issue asks for the editor's own undo state as the checkpoint.
