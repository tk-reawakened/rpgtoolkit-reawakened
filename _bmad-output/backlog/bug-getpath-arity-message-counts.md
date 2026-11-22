---
id: 29
type: bug
title: "getpath arity diagnostic names argument counts the command rejects"
parent: none
covers: []
after: []
assignee: ""
tracker_id: "#3335"
remote: "https://github.com/tk-reawakened/rpgtoolkit-reawakened/issues/3335"
refined: true
hitl: false
risk: low
severity: P2
---

# getpath arity diagnostic names argument counts the command rejects

## Description

Found by the #1281/#1300/#3315 acceptance audit at `origin/main` 5035734d7.

`playergetpath()` and `playergetpath(h,i,j,k,l)` raise the VM's generic `arity.mismatch` message "takes 1 to 4 argument(s)" (`packages/core/src/script/vm.ts`, `checkArity`), but the handler rejects 2 and 3 arguments with "takes 1 or 4" (`packages/core/src/script/packs/movement.ts`, `getPathCommand`). The generic message therefore advertises two counts that always fail. ERR-2 (`docs/spec/engine/rpgcode-errors-and-threads.md`) wants the count the command needs named, and ticket 23's acceptance criterion 5 says "naming one or four".

There is also a proof gap: every getpath test calls the spec directly, bypassing `checkArity`. Nothing proves the one-argument call is admitted by the VM boundary, and the 0 and 5+ arities are untested (`packages/core/test/movement-rulings.test.ts` covers 2 arguments only).

The issue is not a #3315 blocker: #3315 itself only requires the catchable error.

## Reproduction

1. Call `playergetpath()` or `playergetpath(h,i,j,k,l)` through the VM.
2. Actual: the error says "takes 1 to 4 argument(s)", although 2 and 3 arguments are rejected by the handler with "takes 1 or 4".
3. Also actual: no VM-level test covers the accepted one-argument and four-argument forms, and none covers 0 or 5+ arguments.
4. Expected: every rejected count raises a catchable arity error naming one or four, and the VM boundary admits exactly the counts the handler accepts.

## Cause Hypothesis

`checkArity` derives its message from `required` and `params.length` (1 and 4), so it cannot describe a non-contiguous accepted set (1 or 4). The parameter model has no accepted-counts field. The tests exercise the handler directly, so the VM-level message and boundary were never pinned.

## Acceptance Criteria

1. **The VM message names one or four**
   **Given** `playergetpath` or `itemgetpath` called with 0, 2, 3 or 5+ arguments through the VM
   **When** the call fails
   **Then** it raises a catchable `arity.mismatch` naming one or four (not "1 to 4"), and writes nothing
2. **The VM boundary admits the accepted forms**
   **Given** a VM-level call
   **When** `playergetpath` or `itemgetpath` is called with exactly one argument or exactly four
   **Then** the call reaches the handler through `checkArity` and behaves as R-69 specifies
3. **The accepted set has one source of truth**
   **Given** the parameter model
   **When** a built-in accepts a non-contiguous set of counts
   **Then** the model (for example an accepted-counts field) and the handler agree, or ticket 23 criterion 5's wording is amended deliberately and documented
4. **Ticket 23 wording is fixed**
   **Given** ticket 23's ambiguous "none beyond the handle" phrasing
   **When** the ticket is read
   **Then** it states the accepted counts unambiguously

## References

- issue — https://github.com/tk-reawakened/rpgtoolkit-reawakened/issues/3335
- VM arity check — `packages/core/src/script/vm.ts` (`checkArity`)
- handler — `packages/core/src/script/packs/movement.ts` (`getPathCommand`)
- ERR-2 — `docs/spec/engine/rpgcode-errors-and-threads.md#err-2`
- tests — `packages/core/test/movement-rulings.test.ts`; the getpath suite that bypasses `checkArity`
- ticket 23 — `_bmad-output/backlog/bug-getpath-commands-do-not-report-the-live-queue.md`

## Notes

- The audit found this while verifying #3315; #3315 only requires the catchable error, so this ticket owns the message/boundary proof.
- Do not weaken the handler's rejection of 2 and 3 arguments to match the generic message.
