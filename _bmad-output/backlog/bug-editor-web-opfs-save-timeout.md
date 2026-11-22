---
id: 27
type: bug
title: "Editor-web save proof can miss the flushed OPFS bytes within its poll"
parent: none
covers: []
after: []
assignee: ""
tracker_id: "#3306"
remote: "https://github.com/tk-reawakened/rpgtoolkit-reawakened/issues/3306"
refined: true
hitl: false
risk: medium
severity: P2
---

# Editor-web save proof can miss the flushed OPFS bytes within its poll

## Description

CI run 44901596695 failed in `browser (editor-web)`: the connected-authoring test polled for the saved OPFS bytes, but after its 5-second poll the file still contained the previous bytes. The failed job passed on rerun. Locally, the complete editor-web suite passed 48/48, and the exact failing test passed.

The proof saves a program, reads it back through the host and polls for the exact bytes (`tools/editor-vscode-test/connected-authoring-proof.ts`). The default poll window is the only signal that the OPFS write is visible, so a slow flush is reported as a save that never happened. This is recorded as a flaky timing failure; the save and flush visibility must be investigated without weakening the assertion.

## Reproduction

1. Run `browser (editor-web)` with the connected-authoring spec (`tools/browser/tests/editor-connected-authoring.spec.ts`).
2. Let the proof save a program and poll for its bytes in OPFS.
3. Actual: after the 5-second poll the file still holds the previous bytes, and the proof reports that the saved text never appeared.
4. Expected: the proof observes the save only once the host reports the write is flushed and visible, and a genuinely missing save still fails.

## Cause Hypothesis

The proof treats "the bytes changed within the default poll window" as the flush signal. OPFS write visibility after save can lag the editor's save acknowledgement, so a loaded CI runner can outrun the poll while a local run does not. The rerun passing is consistent with a timing window, not a deterministic save defect.

## Acceptance Criteria

1. **The proof waits on the host's own flush state**
   **Given** an editor-web save of a program
   **When** the proof reads the saved bytes back
   **Then** it waits for the host's save/flush/visibility signal (or an equivalent deterministic acknowledgement), not only a fixed 5-second text expectation
2. **A missing save still fails**
   **Given** a save that never reaches OPFS
   **When** the proof waits
   **Then** it still fails, with the editor and host state reported — the assertion is not weakened or skipped
3. **Repeated full-spec runs are stable**
   **Given** the fix
   **When** the editor-web spec is run repeatedly in full
   **Then** the connected-authoring test passes without relying on a lucky rerun

## References

- issue — https://github.com/tk-reawakened/rpgtoolkit-reawakened/issues/3306
- failing run — 44901596695, `browser (editor-web)`
- spec — `tools/browser/tests/editor-connected-authoring.spec.ts`
- proof — `tools/editor-vscode-test/connected-authoring-proof.ts` (`writeProgram`, the `host.read` poll after save)
- owner pacing rule — `AGENTS.md`, "Prevent test and host overload" (Owner rule, 2026-11-07)

## Notes

- A green rerun alone is not proof; the issue asks for the save/flush visibility timing to be understood.
- Do not widen the timeout only: an unbounded wait still cannot distinguish a slow flush from a save that never happened.
