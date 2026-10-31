---
type: discovery
title: "Closure audit: the eight epics that have no breakdown yet"
date: 2026-10-31
baseline_revision: 26740257db3b692b5b210b05b489f60057d35e72
---

# Envelope audit (no `tickets.toml`)

Eight epics carry an envelope with an Outcome and a Done-when list but no breakdown, so they have no entries to
reconcile and nothing implementation-shaped to test. This audit records, for each, whether the envelope's claims are
already contradicted by the repository and whether any gap is real *and unowned*. It does **not** invent a breakdown.

| Epic | Breakdown | Implementation present | Done-when status | Real, unowned gap |
|---|---|---|---|---|
| `epic-desktop-shell` | none | no `packages/host-desktop` | unproven — nothing implemented; no package exists in `packages/` | no |
| `epic-documentation-website` | none | no site package; `docs/` is the reference | unproven for the site itself; the reference content it would publish exists under `docs/spec` | no |
| `epic-editor-assets-p0` | none | no `packages/editor-*` | unproven | no |
| `epic-editor-foundation` | none | no `packages/editor-ui`, `host-web`, `host-vscode` | unproven | **yes — see F-01** (it is the seam 22.9 waits on, and it has no tracked identity) |
| `epic-editor-p1` | none | no editor package | unproven | no |
| `epic-editor-p2` | none | no editor package | unproven | no |
| `epic-rpgcode-tooling` | none (has `tracker_id: "#666"`) | no `tools/` command named by it beyond the existing gates | unproven | no |
| `epic-web-runner-packaging` | none | no web runner package | unproven; carries the epic-6 browser-test open question (#877) in Notes | no (already recorded) |

## Findings

- **F-01 (real, unowned, filed).** Seven of the eight envelopes have **no `tracker_id` and no GitHub parent issue**,
  which contradicts the repository rule that every BMAD ticket in `_bmad-output/` has a corresponding GitHub issue
  (`AGENTS.md`, “GitHub Project is the primary interface”). It cannot be fixed mechanically:
  `tools/create-epic-on-github.py <slug>` refuses without a `tickets.toml`
  (“Expected …/epic-editor-foundation/tickets.toml”), so each envelope needs a breakdown (an owner planning decision)
  before it can get a parent issue. Filed as its own issue; the specific consequence already flagged by Epic 22 —
  22.9 waits on `epic-editor-foundation`'s seams and cannot resolve its actual tracked ticket — is the strongest
  argument for doing `epic-editor-foundation` first.
- No other envelope claims anything the repository contradicts: each is honest future work with an Outcome and a
  Done-when, and none is presented as delivered.
