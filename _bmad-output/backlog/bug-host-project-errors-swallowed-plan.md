---
title: "Report host-web project failures with their operation scope"
type: bugfix
ticket: '31'
created: '2026-11-22'
status: 'ready-for-dev'
baseline_revision: '69c4d6345058fe504db4f110ffab91805a98d1ee'
route: 'oneshot'
route_source: 'auto'
risk: 'low'
review: 'none'
review_source: 'auto'
lenses_ran: []
review_loop_iteration: 0
context:
  - '{project-root}/docs/guardrails.md'
  - '{project-root}/packages/host-web/src/projects.ts'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** The web host discards IndexedDB failures when it opens, reads, writes, compares or restores a project, so a version mismatch (a stale `tkr-editor-projects` database at a newer version) is reported to the author as an unusable folder.

**Approach:** Add `reportHostError(scope, error)` (`packages/host-web/src/host-log.ts`): it logs `[tkr-host] <scope>: <name>: <message>` to the console and keeps the last 50 failures in memory for later telemetry. Replace each silent catch in `projects.ts` with a report that names the operation, leaving every return value exactly as it was.

## Boundaries & Constraints

**Always:** Keep the returned `null`/`false` exactly as before, so no caller changes behaviour; keep the record bounded; name the operation scope (`projects.open`, `projects.read`, `projects.write`, `projects.sameEntry`, `projects.restore`).

**Never:** Change control flow, retry, or surface the message in the UI from this change; add other hosts' catches here.

</frozen-after-approval>

## Verification

**Commands:**
- `node --test packages/host-web/test/projects.test.ts` — a `VersionError` from `openDatabase` is recorded as `projects.open`, and the existing tests still pass.
- `tsc -b packages/host-web` and `tsc -p packages/host-web/tsconfig.test.json`.

## Implementation Notes

`reportHostError` lives in `host-log.ts` next to `hostErrors()`, which returns a copy of the bounded list. `projects.ts` reports at each former `catch {}`/`onerror` site; `restoreWebProject` reports as `projects.restore` before returning `null`.
