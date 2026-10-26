---
id: 23
type: epic
title: "Deferred work: hardening and carry-forward"
tracker_id: "#639"
remote: "https://github.com/tk-reawakened/rpgtoolkit-reawakened/issues/639"
parent: initiative-rpgtoolkit-reawakened
status: in-progress
---

# Deferred work: hardening and carry-forward

## Outcome
Promote verified, still-open findings from `deferred-work.md` into focused, buildable tickets without reopening completed epics or turning historical evidence into assumed current defects.

## Done when
1. Every promoted finding has a ticket with current evidence, acceptance criteria, and deterministic verification.
2. Findings already resolved, duplicated by existing tickets, dependent on unavailable evidence, or awaiting an owner decision remain in the deferred ledger with their disposition recorded.
3. Build tickets follow G7: any required spec or owner decision lands before implementation.
4. The ledger remains an intake and audit record; promotion does not erase its history.

## Boundaries
- This epic owns cross-epic hardening and carry-forward only; domain changes remain in the existing domain epic when it is still open and appropriate.
- Do not revive completed epics to append stories.
- Do not promote stale findings without rechecking current code, tests, and tickets.
- Do not implement behavior for which the normative docs or owner ruling are absent.

## Initial scope
- Revalidate and harden legacy actor and battle writers against invalid values that currently serialize silently.
- Pin the still-missing pre-vector board run-overrun behavior with a consumer-visible regression test; do not duplicate the existing negative-LUT test.
- Record owner rulings for unresolved first-board and no-board rendering behavior before any code change.
- Plan GitHub-centered ticket management as cross-epic workflow hardening; implementation waits for owner-approved design.

## Ordering note
Although this is Epic 23, do this carry-forward work before taking up unrelated future epics when its tickets are ready. Epic-number ordering alone may not recommend it first.

## Notes

- Decision: 2026-10-26 — The owner directs this planning-only GitHub ticket-tooling spike into Epic 23 as cross-epic workflow hardening; it is not a promotion from the existing deferred-work ledger. No implementation ticket is cut before owner approval.
- Decision: 2026-10-26 — A separate Refactor sweep story is not needed for the current set: the existing entries are independent deferred findings, and this spike plans rather than changes shared code or configuration. Reassess if implementation tickets are later added.
