---
title: "Plan GitHub ticket tooling around GitHub as source of truth"
ticket: 5
status: draft
---

# Spike plan: GitHub ticket tooling and source of truth

## Goal

Write and owner-review a decision-ready design for safe GitHub-centered ticket work in one design pass and one owner-review pass, with no calendar deadline; further work requires owner agreement or a follow-up planning ticket. This spike plans the tooling; it does not implement it.

## Tasks

- [ ] Recheck the reported script safety issues and manual closeout steps; compare the two ticket-17 claimant paths and statuses in the affected owner checkout and `origin/main`, record the snapshot difference, and preserve both plans unless evidence identifies the real one. Separately determine the intent and disposition of the owner's one-line `tickets.py` change that sets loaded `tracker_id` to empty.
- [ ] Inventory the issue, sub-issue, and project-board fields and the BMAD skills/workflows that read the ticket files.
- [ ] Map the operations and read/write responsibilities for humans, director sessions, and workers, including `gh`/API access without a repository PR for status or acceptance changes.
- [ ] Compare GitHub as source of truth with generated ticket files, thin pointers, and retiring `tickets.toml`/plan files; decide migration and audit requirements.
- [ ] Specify scoped, previewable, idempotent GitHub writes; read-only drift checks; merged-PR closeout and test-backed acceptance evidence; project sprint and sub-issue handling; and `Fixes`/`Refs` rules.
- [ ] Record the recommended design and open questions in `github-ticket-tooling-design.md` in this epic folder.
- [ ] Get owner approval of the design before creating any implementation ticket.

## Verification

- [ ] The design note covers all seven acceptance criteria in the spike ticket.
- [ ] The owner’s approval is recorded in the design note or a linked GitHub comment.
- [ ] No tooling implementation or implementation ticket is included in this spike.
