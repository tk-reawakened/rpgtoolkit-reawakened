---
title: "Wait on the editor's undo checkpoint instead of a fixed text expectation"
type: bugfix
ticket: '28'
created: '2026-11-22'
status: 'ready-for-dev'
baseline_revision: 'd8a348c58298f6dc27a5097f939d54bd45b595d9'
route: 'oneshot'
route_source: 'auto'
risk: 'medium'
review: 'none'
review_source: 'auto'
lenses_ran: []
review_loop_iteration: 0
context:
  - '{project-root}/docs/guardrails.md'
  - '{project-root}/AGENTS.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** The connected-authoring proof types into the editor, presses undo and waits for the pre-insert first line with a fixed 5-second text expectation. When undo is applied asynchronously the expectation can expire first, so the editor-web lane reports a missing undo even though the document later reaches the right state.

**Approach:** Follow the issue's "what proves a fix": wait for the undo checkpoint deterministically (the editor's own document version/undo state, or an equivalent signal) instead of a fixed text expectation, and make the test pass repeatedly across full-spec runs. A real missing undo must still fail.

## Boundaries & Constraints

**Always:** Keep the exact pre-insert text assertion; keep the failure diagnostic; use an editor-owned deterministic checkpoint; prove the fix across repeated full-spec runs.

**Never:** Treat a green rerun as proof; skip or loosen the undo assertion; paper over the race with a longer fixed timeout alone.

</frozen-after-approval>

## Verification

**Test strategy:**
- Run the connected-authoring proof in `browser (editor-web)` with the editor's undo checkpoint awaited, and assert the pre-insert text is observed.
- Add a negative case where undo never restores the document and assert the proof still fails.
- Run the complete editor-web spec repeatedly to show the race is gone.
- Perturbation: remove the checkpoint wait and confirm the simulated slow-undo case fails; restore it and confirm the missing-undo case still fails.

**Commands:**
- The lane's `browser (editor-web)` spec command.
- `pnpm bmad:tickets:test`.

## Implementation Notes

## Perturbation Check

| Guard reverted | Test that failed |
|---|---|
| | |
