---
id: 35
type: bug
title: "Native new-project recovery proof loses its restore-group Quick Pick"
parent: none
covers: []
after: []
assignee: ""
tracker_id: "3510"
remote: "https://github.com/tk-reawakened/rpgtoolkit-reawakened/issues/3510"
refined: false
hitl: false
risk: medium
severity: P2
---

# Native new-project recovery proof loses its restore-group Quick Pick

## Description

The VS Code web acceptance proof for native new-project recovery fails after the recovery group picker displays the expected history entry. The row is found, but it becomes unstable and then invisible while the proof tries to select it, so the required acceptance run times out before checking the restore action.

## Reproduction

1. Run the required VS Code web editor acceptance proof in GitHub Actions, workflow run 45870246287, job 140083635725, on commit `d9f3daf951ae4b2f6b8bcc7c4c4f8e768770558e`.
2. Open `TK Reawakened: Project recovery`, select the new-project workspace, and wait for the persistent recovery group picker.
3. Select the `before-restore` group containing `Boards/Native history board.brd: written`.
4. Actual: Playwright resolves exactly one matching option, then its click times out after 30 seconds. The log reports `not stable` and later `not visible` on repeated attempts. Expected: the selected group opens its action picker, including `Restore group`.
5. The failure is recorded at https://github.com/tk-reawakened/rpgtoolkit-reawakened/actions/runs/45870246287/job/140083635725.

## Cause Hypothesis

The recovery Quick Pick entry is present when queried but ceases to be actionable during a pointer click. The cause may be a host/list rerender or interaction between the proof and the picker; the CI log does not establish which.

## Acceptance Criteria

1. **The recovery group remains selectable**
   **Given** the native new-project recovery proof has opened the persistent recovery group picker and found the `before-restore` history entry
   **When** the proof selects that entry
   **Then** the action picker appears with `Restore group`, and the existing refusal and restore checks still run
2. **Tests cover the condition found and fixed**
   **Given** the focused VS Code web proof in the CI browser environment
   **When** it runs
   **Then** it covers selecting the displayed history entry and fails if the entry disappears or the action picker does not open
3. **Closure without a verified fix**
   **Given** the recorded reproduction and no verified fix for its cause
   **When** the diagnostic and final-proof criteria below are satisfied
   **Then** record evidence showing the failure was transient or unrelated to this code in Notes. Closure may include proof-only diagnostic changes.

4. **Failures stay diagnostic**
   **Given** the proof cannot select the displayed recovery group, open its action picker, or select the attempted action
   **When** it reports the failure
   **Then** the report names both the exact selected recovery group and attempted action (including `Restore group` when that action is being selected); the check is not hidden by retries, a longer timeout, or a weaker assertion
5. **The final proof gates every closure path**
   **Given** the final proof revision, including any product or diagnostic changes
   **When** it is verified for closure
   **Then** the complete focused proof passes repeatedly, including recovery refusal and restore, diagnostics at group selection, action-picker opening, and action selection name both the exact selected recovery group and attempted action, and the VS Code web editor acceptance proof passes on that same revision. Do not count runs from an earlier proof revision.

## References

- Parent story — https://github.com/tk-reawakened/rpgtoolkit-reawakened/issues/1736
- GitHub bug — https://github.com/tk-reawakened/rpgtoolkit-reawakened/issues/3510
- Failing CI job — https://github.com/tk-reawakened/rpgtoolkit-reawakened/actions/runs/45870246287/job/140083635725
- CI workflow — `.github/workflows/ci.yml`, VS Code web editor acceptance proof

## Notes

- Observation only: the CI run failed while selecting the recovery group. The cause is not established; do not increase timeouts or weaken the recovery assertions without evidence.
