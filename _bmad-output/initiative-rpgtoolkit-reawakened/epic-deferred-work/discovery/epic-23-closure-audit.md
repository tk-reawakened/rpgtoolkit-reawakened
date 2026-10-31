---
type: discovery
title: "Closure audit: epic 23 (deferred work), criterion by criterion"
date: 2026-10-31
baseline_revision: 26740257db3b692b5b210b05b489f60057d35e72
---

# Epic 23 closure audit

Audited at **`26740257`**. This epic is an intake ledger, and **another session is actively working it** (PR #876,
`docs/851-ledger-dispositions`), so this audit is read-only: no entry, plan or ledger file was touched.

| # | Done when | Verdict | Evidence |
|---|---|---|---|
| 1 | Every promoted finding has a ticket with current evidence, acceptance criteria and deterministic verification | **In flight (23.12 / #851, 23.13 / #852)** | Promoted tickets exist and are filed as issues with acceptance criteria (#851 and #852 are the two remaining ledger tickets and are open); their own acceptance is the criterion |
| 2 | Findings already resolved, duplicated, dependent on unavailable evidence or awaiting an owner decision stay in the ledger with their disposition recorded | **In flight (23.12 / #851)** | The ledger `deferred-work.md` is present; dispositions are exactly what #851 records |
| 3 | Build tickets follow G7: any required spec or owner decision lands before implementation | **Proven so far** | Every promoted ticket that needs a rule is a `spike` with `hitl: true` (23.5 / #680, 23.14 / #854, 23.15 / #855, and 21.12 / #843 in the media epic); none of them carries implementation |
| 4 | The ledger remains an intake and audit record; promotion does not erase its history | **Proven** | `deferred-work.md` retains the original findings alongside their promotions; no audit record was rewritten this session |

## Findings

- **F-01 (active session, no action).** 23.12 / #851 and 23.13 / #852 are in the other session's hands; #680, #854 and
  #855 are owner-gated spikes; #642 is a rule question. Nothing here is mine to deliver, and filing anything would
  duplicate that work.
  - Recommendation (for the owner, when the ledger session hands back): accept dispositions only with a merged-evidence
    link per finding, and let a `resolved-by:` field name the commit rather than the issue, so the ledger stays
    auditable after tickets close.
  - Rejected alternative: close deferred findings when their ticket closes. That loses the evidence trail the epic
    exists to keep and makes a re-opened defect invisible.
- Store: 9/9 closed entries read `done`; the six open ones read their real state. No correction.
