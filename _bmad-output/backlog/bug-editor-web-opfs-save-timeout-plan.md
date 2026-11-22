---
title: "Wait on the host flush state instead of a fixed poll for saved OPFS bytes"
type: bugfix
ticket: '27'
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

**Problem:** The editor-web connected-authoring proof saves a program and polls `host.read(path)` for the exact bytes with only the default 5-second window as the flush signal. On a loaded CI runner the OPFS bytes can still be the previous ones when the poll expires, so a save that is merely slow to become visible is reported as absent.

**Approach:** Follow the issue: investigate the save/flush visibility timing and wait for the host's own flush/visibility acknowledgement (or an equivalent deterministic signal) rather than a fixed text expectation, without weakening the assertion. A genuinely missing save must still fail with the editor and host state.

## Boundaries & Constraints

**Always:** Keep the exact-bytes assertion; keep the diagnostic that reports the editor state on failure; use the host's save acknowledgement or a deterministic visibility signal; keep the spec stable across repeated full runs.

**Never:** Skip, retry-until-green or weaken the assertion; replace the wait with an unbounded timeout that cannot fail; change save semantics to make the test pass.

</frozen-after-approval>

## Verification

**Test strategy:**
- Run the connected-authoring proof in `browser (editor-web)` and assert it waits on the host's flush state and still reads the exact saved bytes.
- Add a negative case where the save never flushes and assert the proof still fails with its diagnostic.
- Run the editor-web spec repeatedly in full to show the flake is gone.
- Perturbation: remove the flush wait and confirm the simulated slow-flush case fails; restore it and confirm the missing-save case still fails.

**Commands:**
- `pnpm --filter @tk-reawakened/browser test` (or the lane's editor-web spec command).
- `pnpm bmad:tickets:test`.

## Implementation Notes

## Perturbation Check

| Guard reverted | Test that failed |
|---|---|
| | |
