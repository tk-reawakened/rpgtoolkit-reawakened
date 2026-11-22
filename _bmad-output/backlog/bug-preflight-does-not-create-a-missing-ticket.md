---
id: 24
type: bug
title: "A valid issue with no ticket is blocked instead of getting one"
parent: none
covers: []
after: []
assignee: ""
tracker_id: "#3342"
remote: "https://github.com/tk-reawakened/rpgtoolkit-reawakened/issues/3342"
refined: true
hitl: false
risk: low
severity: P2
---

# A valid issue with no ticket is blocked instead of getting one

## Description

Every BMAD ticket must name a GitHub issue, but the reverse case had no rule. When an issue had no ticket, the preflight reported `not_found` and told the reader not to create one, and `CONTRIBUTING.md` repeated that instruction. A valid issue could therefore never acquire the ticket the process requires.

The rule is now: inspect the `mentions` plans first, then create one BMAD ticket linked to the existing issue (`tracker_id = "#N"`) with `bmad-ticket`, rerun the preflight with `--check-stock`, and validate the store before handoff. Never create a second GitHub issue. Duplicate, conflicting or malformed identities still stop.

## Reproduction

1. Pick an open issue that no ticket carries and that no plan mentions.
2. Run `uv run .agents/skills/tkr-issue-preflight/scripts/resolve_issue.py "#N" --project-root . --check-stock`.
   Actual before the fix: `ok: false`, `code: not_found`, and an error telling the reader not to create an issue or a ticket. `AGENTS.md` and `CONTRIBUTING.md` agreed with it, so the work stopped.
   Expected: the preflight and docs direct the reader to create one linked ticket, and the resolver continues to exit non-zero and list `mentions`.

## Cause Hypothesis

The preflight treated only one published-ticket direction as safe: it refused to create a ticket because it could not see whether the issue was unpublished or mistyped. The docs encoded the same refusal as policy instead of asking for an explicit check of the issue and its plan mentions.

## Acceptance Criteria

1. **The rule is documented in every process surface**
   **Given** `AGENTS.md`, `CONTRIBUTING.md` and the `tkr-issue-preflight` skill
   **When** a reader meets an issue with no ticket
   **Then** all three say to create one BMAD ticket linked to that issue, name `--check-stock` and store validation, and keep duplicate or conflicting identities blocking
2. **The resolver still never writes**
   **Given** any `not_found` result
   **When** the resolver runs
   **Then** every file in the store is untouched, the process exits non-zero, and `mentions` is still present
3. **The message points at the safe action**
   **Given** a `not_found` result
   **When** the error is read
   **Then** it says to verify the issue and plan mentions before creating a linked ticket and not to create a duplicate issue, and the old "do not create an issue or a ticket" wording is gone
4. **Tests pin the guidance**
   **Given** the preflight test suite
   **When** the message or the non-zero `mentions` contract regresses
   **Then** a test fails for that reason

## References

- issue — https://github.com/tk-reawakened/rpgtoolkit-reawakened/issues/3342
- rule — `AGENTS.md`, GitHub Project owner rule
- skill — `.agents/skills/tkr-issue-preflight/SKILL.md`
- resolver — `.agents/skills/tkr-issue-preflight/scripts/resolve_issue.py`

## Notes

- Decision (2026-11-21, owner Jensen): an issue with no ticket gets a ticket linked to it; a duplicate GitHub issue is never created, and duplicate or conflicting identities still stop.
- This PR dogfoods the rule: issue #3342 and this ticket are the first pair created under it.
