---
id: 5
type: spike
title: "Plan GitHub ticket tooling around GitHub as source of truth"
parent: epic-deferred-work
tracker_id: "#680"
remote: "https://github.com/tk-reawakened/rpgtoolkit-reawakened/issues/680"
after: []
hitl: true
risk: medium
---

# Plan GitHub ticket tooling around GitHub as source of truth

## Description

**Guiding principle:** Ideally GitHub replaces the local BMAD ticket process, so that no more PRs have to be opened just to handle tasks (marking done, ticking acceptance, status changes).

This spike answers how people and agents should plan, track, and close tickets through GitHub issues, native sub-issues, project fields, labels, comments, and checklists. This is planning only: do not implement tooling or create implementation tickets until the owner reviews and approves the written design. Any later implementation tickets for these workflows wait on this spike.

Revalidate these observations as input to the design:

- Issue-body synchronization has no per-issue filter or dry-run, ignores `--help`, and can PATCH every ticket issue; an accidental run rewrote 16 issue bodies, later restored from edit history. Review the migration and sub-issue-linking tools for the same risks.
- The owner reported `tickets.py find` failing globally because two Epic 19 plans claim ticket 17, halting unrelated build workflows. The owner checkout has both reported plan paths, while the `origin/main` worktree used for this ticket has only the second plan and a similarly named story leaf at the first path; recheck the affected checkout before deciding which plan is canonical.
- Closing a ticket after a PR merges is manual: mark it done, update acceptance with test evidence, sync its issue body, prepare a chore PR, and merge it.
- Needed capabilities include a read-only drift check, native sub-issue links, project sprint fields, and the right `Fixes`-versus-`Refs` behavior for partial tickets.
- The owner's uncommitted local edit to `tickets.py` in the main checkout must be reconciled before any tooling implementation.

## Approach

Scope: one design pass and one owner-review pass; further analysis needs owner agreement or a follow-up planning ticket. Do not modify tooling or create implementation tickets in this spike.

1. Recheck the reported workflow and ticket-tree problems, comparing both ticket-17 claimant paths and statuses in the affected owner checkout versus `origin/main`; record the discrepancy. Reconcile the uncommitted `tickets.py` edit separately.
2. Map the operations and information needed by humans, director sessions, and workers, including how each reads and writes GitHub through `gh` or the API without a repository PR for status or acceptance changes.
3. Evaluate GitHub as the single source of truth against keeping `tickets.toml` and plan files as generated data, reducing them to thin pointers, or retiring them. Recommend one approach, explain its tradeoffs, and sequence migration for existing epics.
4. Specify safe write behavior, read-only drift checks, ticket closing and acceptance evidence, PR references, native sub-issues, project fields, audit history, offline work, clean-room provenance, and affected BMAD skills.
5. Record the recommendation, required operations, migration path, and unresolved questions in `github-ticket-tooling-design.md` in this epic folder. The owner reviews and approves it before any implementation ticket is created.

Good enough: the design lets the team decide how GitHub becomes the normal interface while preserving ticket history and making accidental issue-wide writes difficult.

## Acceptance Criteria

1. **A decision-ready design note records the current evidence.**
   Verify: `github-ticket-tooling-design.md` rechecks all reported pain points, records the exact ticket-17 claimant paths and statuses on the affected owner checkout and base revision, explains which artifacts remain, and captures the owner's `tickets.py` disposition separately; if evidence does not identify the real plan, it preserves both and reports the duplicate to the director.
2. **The source of truth and migration are explicit.**
   Verify: the note evaluates GitHub issues, sub-issues, project fields, labels, comments, and checklists as canonical data against generated `tickets.toml`/plan files, thin pointers, or retiring those files; it recommends an approach and migration sequence for existing epics.
3. **The people and agent workflows are covered.**
   Verify: the note names the operations needed by humans, director sessions, and workers; says what each reads or writes through `gh`/API; and shows how routine status or acceptance updates need no repository PR.
4. **Write safety and read-only checks are specified.**
   Verify: the note defines scoped writes, help, dry-run previews, issue/ticket/epic filters, unchanged-body no-ops, and clear summaries; the drift check covers missing `tracker_id`, GitHub issue state versus ticket status, body drift, missing native sub-issue links, every ticket having a tracker ID, and every open Epic 7 issue matching `tickets.toml`.
5. **Closing and project-board behavior are specified.**
   Verify: the note covers merged-PR closeout, drafts acceptance evidence from the PR and tests, checks only acceptance items whose named test exists in the repository, and lists unchecked items otherwise; distinguishes `Fixes` from `Refs` for partial tickets; and puts unstarted work in Backlog with no sprint while specifying native sub-issue linking.
6. **The design addresses governance and owner questions.**
   Verify: the note addresses status-change auditability, offline work, clean-room provenance, and the effect on BMAD skills/workflows that read `tickets.toml`; unresolved questions remain explicit rather than silently decided.
7. **The owner accepts the design before implementation is planned.**
   Verify: the design records owner approval, no implementation ticket is cut before that approval, and this spike contains no tooling implementation.

## References

- parent — _bmad-output/initiative-rpgtoolkit-reawakened/epic-deferred-work/epic-deferred-work.md
- repo policy — AGENTS.md, GitHub Project is the primary interface
- contributor process — CONTRIBUTING.md, Pick and claim an issue

## Notes

- Observation: Revisit `tools/sync-issue-bodies.py`, `tools/migrate-tickets-to-github.py`, `tools/link-epics-subissues.py`, and `_bmad/method/scripts/tickets.py`.
- Observation: The owner-reported ticket-17 collision names `_bmad-output/initiative-rpgtoolkit-reawakened/epic-rpgcode-platform/story-implement-package-catalogue-loader-and-startup-runtime-plan.md` and `_bmad-output/initiative-rpgtoolkit-reawakened/epic-rpgcode-platform/story-package-catalogue-loader-runtime-and-package-startup-lifecycle-plan.md`; both plans are status `done` in the owner checkout. The `origin/main` worktree has the second plan and a similarly named first-path story leaf (`id: 17`, tracker `#562`) rather than the first `-plan.md`. Record the affected revision and the separate `tickets.py` local-edit decision; do not delete either plan without clear evidence.
- Open question: What planning content stays in the repository, and what becomes generated, a thin pointer, or is retired?
- Open question: How should status and acceptance changes remain auditable when they no longer land through repository PRs?
- Open question: What offline-work and clean-room provenance requirements must the design preserve?
- Open question: How should existing epics and ticket data migrate to the chosen source of truth?
- Open question: Which BMAD skills and workflows must change because they currently read `tickets.toml` or plan files?
- Open question: If evidence does not identify the real ticket-17 plan, how should the duplicate be reported to the director? Preserve both until it is clear.
- Open question: What tool permissions and confirmation rules should apply to human, director, and worker write operations?
- Risk rationale: a poor source-of-truth or write-safety design could lose ticket history or change the wrong GitHub issues.
