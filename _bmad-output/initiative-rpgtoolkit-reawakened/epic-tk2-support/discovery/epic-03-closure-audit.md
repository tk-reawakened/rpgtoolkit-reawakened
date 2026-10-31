---
type: discovery
title: "Closure audit: epic 3 (TK2 support), criterion by criterion"
date: 2026-10-31
baseline_revision: 3c7c71903422c3025ca592cac330e0b9b4381adf
---

# Epic 3 closure audit

Audited at **`3c7c7190`**. All 13 child issues are CLOSED and their tickets read `done`.

| # | Done when | Verdict | Evidence |
|---|---|---|---|
| 1 | The dump tool parses every data file of the six archived TK2 games with 0 failures and 0 residue bytes, apart from files ruled out by name | **Proven** | `pnpm dump fixtures/legacy/{FinalDestiny,LittleMan,BusDriver,Caoquest,School2Demo,ChimeranEmpire}` each ends `… parsed, … skipped, **0 failed**`; readers report leftover bytes as `residue` (`packages/core/src/formats/actor/character.ts:102,646-648` and the same field across the TK2-era readers), so a non-empty residue would surface as a failure |
| 2 | Every implemented layout is stated in the spec before the code (G7), with its evidence; legacy-source facts follow ADR 0006 | **Proven, with a stale citation in the criterion** | The normative pages live under `docs/spec/formats/` (ADR 0007 replaced `docs/format-spec.md` on 2026-10-15; `ls docs/format-spec.md` → absent). The substance holds — the readers cite `docs/spec/formats/*` anchors and the provenance records are in `docs/provenance/` — so this is envelope wording, not a defect and not a ticket |
| 3 | The new readers register in the core format registry and dispatch by extension and magic (AD-31) | **Proven** | `packages/core/src/formats/registry/` (detect-by-magic plus extension) and the `format-*` suites that drive it; `pnpm dump` above exercises the dispatch over every TK2 file |
| 4 | The TK2 games are CI fixtures fetched at test time and never committed, and the corpus gate fails on a regression | **Proven** | `pnpm fixtures:check` → “0 tracked files under fixtures/; `fixtures/` is ignored”; `golden/closing/plan.json` lists the six as expected failures and fails as soon as one starts to boot (`closing: 8/8 games match their baselines … 6 expected failures`) |
| 5 | `core` still builds with no DOM or Node types and imports only `fflate/browser` | **Proven** | `packages/core/tsconfig.json` (`lib: ES2022`, `types: []`), `packages/core/package.json` dependencies `fflate` + `opentype.js`, and `tools/check-core-deps.mjs` inside `pnpm lint` |

## Findings

- **F-01 (envelope wording only, no ticket).** Criterion 2 names `docs/format-spec.md`, a page ADR 0007 retired. The
  rule it states is satisfied against `docs/spec/formats/`; correcting the epic's text is an owner-visible edit to a
  closed epic, so it is recorded here rather than rewritten silently.
- Store: no correction needed — 13/13 entries `done`, 13/13 issues closed.

## Not probed

“0 residue bytes” is verified through the readers' own residue field and the dump's `0 failed` summary rather than a
byte-level diff of every TK2 file against a reference, which no reference exists for (G7 forbids deriving one).
