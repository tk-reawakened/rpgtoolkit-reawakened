---
id: 15
type: bug
title: "VS Code History proof aborts when its preview frame detaches during polling"
parent: none
covers: []
after: []
tracker_id: "#3257"
remote: "https://github.com/tk-reawakened/rpgtoolkit-reawakened/issues/3257"
assignee: ""
refined: false
hitl: false
risk: medium
severity: P2
---

# VS Code History proof aborts when its preview frame detaches during polling

## Description

The native VS Code History acceptance proof can intermittently abort while checking a read-only board preview. The CI job then fails even though the preview request received a response. The proof should finish checking the expected preview or report its normal timeout diagnostic rather than fail because a frame changed during one locator operation.

## Reproduction

1. GitHub Actions run [44661232829](https://github.com/tk-reawakened/rpgtoolkit-reawakened/actions/runs/44661232829), job `136039857253`, on Linux at head `f09101a4324e51ab6facdf738d7f8efb083c4fd9`.
2. Run the `browser (editor-vscode)` job and the `VS Code web editor acceptance proof` step. The proof opens the `Native history board.brd` History preview while checking the new-board flow.
3. Actual: `Error: locator.count: Frame was detached` in `verifyBoardHistoryPreview` at `web-proof.ts:852:11`, called by `proveNativeNewBoard` at `web-proof.ts:1016:27` and `runVscodeNewProjectProof` at `web-proof.ts:478:3`. The correlated preview trace records responses, including `preview-22`, before the exception.
4. Expected: the proof completes its read-only preview assertion or reports its normal timeout diagnostic; a replaced frame does not abort the polling operation.

## Cause Hypothesis

The proof likely retains or queries a frame locator across a preview-webview replacement. The failure occurs after preview responses are received, so an unanswered History RPC alone does not explain this stack. The exact frame lifecycle that invalidates the locator remains to be confirmed.

## Acceptance Criteria

1. **The preview proof survives transient frame replacement**
   **Given** the native VS Code History preview proof is polling for the read-only board preview
   **When** the preview frame detaches and is replaced during a locator operation
   **Then** the proof continues polling until it verifies the expected preview or reports its normal timeout diagnostic, without aborting with `Frame was detached`
2. **Tests cover the failure condition**
   **Given** the VS Code editor proof suite
   **When** it exercises a detached and replaced preview frame
   **Then** a regression test fails on the frame-detach abort and passes when the proof completes or times out normally
3. **Or: no change is needed, with proof**
   **Given** the failed-run evidence
   **When** the current proof is run against the same condition
   **Then** the expected preview is verified or the failure is shown to be unrelated, with evidence recorded in Notes; this supersedes criteria 1 and 2

## References

- issue — https://github.com/tk-reawakened/rpgtoolkit-reawakened/issues/3257
- CI run — https://github.com/tk-reawakened/rpgtoolkit-reawakened/actions/runs/44661232829, job `136039857253`
- source — `tools/editor-vscode-test/web-proof.ts`, `verifyBoardHistoryPreview`
- base run — https://github.com/tk-reawakened/rpgtoolkit-reawakened/actions/runs/44646529795, passed on `4340727b09c0596b68325f721e12182421780124`
- adjacent main run — https://github.com/tk-reawakened/rpgtoolkit-reawakened/actions/runs/44660801855, failed in a different board-properties proof
- related issue — https://github.com/tk-reawakened/rpgtoolkit-reawakened/issues/2857, History preview RPCs that remain pending

## Notes

- Decision: Keep this proof-stability defect separate from unrelated PR #3250 changes; that PR does not modify the editor proof harness. (2026-11-20)
- Evidence: The base run passed, while an adjacent main run also failed the same job at a different proof poll; these runs show suite instability but do not establish the frame-detach cause.
