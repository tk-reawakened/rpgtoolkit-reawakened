---
title: "Refactor sweep"
type: refactor
ticket: 12
created: 2026-11-16
status: in-progress
baseline_revision: ef5575585924d5ba2db3545436148df0ddae6db1
route: oneshot
route_source: auto
risk: low
review_loop_iteration: 0
context:
  - "{project-root}/docs/guardrails.md"
  - "{project-root}/CONTRIBUTING.md"
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Review previous foundation plans and findings for duplicate document handling, registration, dead scaffolds, stale references and boundary drift. Remove only evidenced cleanup debt; cleanup must change no promised authoring capability, and unfinished provider behavior stays explicitly separate.

**Approach:** Preserve working shared ownership and live compatibility/conformance surfaces rather than inventing refactors. Correct stale foundation delivery references, reconcile already-fixed History proof issues against merged evidence, and finish the recorded process-cleanup residual: a non-exiting proof server must not prevent teardown or hide the original proof failure. Keep standalone Git, optional tutorial/tileset providers and the final cross-host acceptance story separate.

</frozen-after-approval>

## Implementation Notes

Oneshot: approximately 100 lines or fewer of focused code/tests, with mechanical documentation corrections. All prerequisites, including 11.14 and its closure metadata, are merged at the baseline. Risk is low because no document model, host ownership or game behavior changes.

- Current browser aliases are retained: they remain exported through `packages/host-web/src/testing.ts`, not proved dead. Registration and boundary checks remain the existing shared model/host graph, not a new registry.
- `tools/editor-vscode-test/lifecycle.ts:33-41` sends SIGTERM then awaits close indefinitely. A real child acknowledged SIGTERM but left cleanup pending and its workspace present until an external SIGKILL; tracked as #2929. Bound the graceful wait to two seconds, then escalate to SIGKILL with a further one-second close deadline, report forced/incomplete shutdown as cleanup failure, and still attempt workspace removal. Keep ordinary shutdown and primary-error aggregation unchanged.
- Add isolated lifecycle regressions using controlled timer advancement and IPC/controlled process completion, not sleeps or elapsed-time assertions. Always release owned children/resources on failure. Prove both escalation and bounded post-kill cleanup; do not merely assert helper wiring.
- #2933 tracks stale ADR 0025/epic allocation notes and the contributor guide's single-field tracer description. Record the split toolchain and mounted CSP delivery without rewriting historical owner decisions or claiming a new policy. Document shutdown behavior before its implementation, in a separate docs-first commit.
- #2859/#2884 describe browser proof fixes now present in merged History. Check each acceptance clause against the actual tests and successful merged-head CI before closing; preserve any uncovered requirement instead of assuming closure.
- Implemented bounded server shutdown with cleared deadline timers, explicit forced/incomplete-shutdown errors, and handle/stdio release if the close receipt is still absent. The original primary-error aggregation and workspace cleanup remain intact. Both new regressions use a real IPC-acknowledging child with open stdin (no real timer sleeps); the second holds its close receipt to exercise the final deadline.
- Verified under pinned Node 24.21.0 (the workstation default is Node 26.13.0). The old implementation failed the new escalation regression in 47.03 ms. Replacing SIGKILL with SIGTERM failed the forced-stop assertion; inserting an unbounded post-kill close wait failed the missing-receipt guard. Restored implementations passed individually in 88.74 ms and 85.22 ms; the complete lifecycle file passed 8/8, zero skips. Root build, proof-test typecheck, scoped lint and provenance (1,641 files, zero violations) passed. Actual native teardown proof and independent review remain pending.

## Plan Change Log

## Review Triage Log

## Verification

- Run each new lifecycle regression alone; inspect duration below one second. Demonstrate targeted red controls for removed escalation/deadline, restore the implementation, and rerun successfully.
- `node --test tools/editor-vscode-test/test/lifecycle.test.ts` — existing spawn, readiness, cleanup and proof-error behavior plus new bounded shutdown cases pass with no skips.
- `pnpm --dir tools/editor-vscode-test typecheck:tests` and scoped ESLint — changed tooling remains type-correct and clean.
- `pnpm provenance` and ticket-store/stock resolution — docs/provenance and scoped plan identity remain valid.
- Build the extension and run the actual native-workbench proof serially to cover ordinary server teardown; no parallel heavy browser/device operations.
- Independent review and required exact-head CI must pass before merging. No golden update, new dependency, owner-rule exception or unverified capability claim.
