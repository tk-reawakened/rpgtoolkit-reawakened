---
id: 33
type: story
title: "Refactor sweep: reconcile Epic 7 review evidence"
parent: epic-battle
tracker_id: "#753"
remote: "https://github.com/tk-reawakened/rpgtoolkit-reawakened/issues/753"
covers: [CAP-9]
after: [21, 22, 23, 24, 25, 26, 27, 28, 29, 30, 31, 32]
hitl: false
risk: medium
---

# Refactor sweep: reconcile Epic 7 review evidence

## Description

After entries 7.21–7.32 land, update Epic 7's evidence additively. Preserve the historical 7.1–7.20 ticket statuses and completed plan checkboxes, but do not treat prior Done-when "met" labels as proof that the full criteria were satisfied. Record what the current evidence proves and what remains open; keep the parent open until the actual gaps and closures are verified.

## Acceptance Criteria

Verify: Each follow-up is reconciled against merged evidence and tracker issue state; the Done-when table clearly labels the 2026-10-28 "met" entries as historical and lists any still-unproven criteria separately; original 7.1–7.20 ticket statuses and completed plan checkboxes are not rewritten; unresolved work remains open and is reported; #503 stays open until every actual Done-when criterion and child issue closure is verified.

## References

- parent — _bmad-output/initiative-rpgtoolkit-reawakened/epic-battle/epic-battle.md
- tracker — _bmad-output/initiative-rpgtoolkit-reawakened/epic-battle/tickets.toml
- plan — _bmad-output/initiative-rpgtoolkit-reawakened/epic-battle/epic-battle.md, Done-when evidence

## Notes

- This future closeout task preserves historical status without claiming prior criteria were actually met; it does not rewrite completed plan checkboxes. Owner-input spikes 7.25–7.27 must record their rulings before dependent work is treated as resolved.
- Risk rationale: medium — Incorrect evidence could make the epic appear complete before it is; the ticket must preserve the historical record and keep #503 open until verified.
