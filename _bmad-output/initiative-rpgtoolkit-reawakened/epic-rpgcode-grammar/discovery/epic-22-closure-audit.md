---
type: discovery
title: "Closure audit: epic 22 (independent RPGCode syntax), criterion by criterion"
date: 2026-10-31
baseline_revision: de43ad735ee4e1014aa9ea67165fa76f61edf492
issue: "#624"
---

# Epic 22 closure audit

Audited against merged code, tests and evidence at **`de43ad73`**, not ticket status. Method: take the epic's
Done-when and its five cross-cutting acceptance clauses from `epic-rpgcode-grammar.md`, then look for each one in
`packages/`, `golden/`, `tools/`, `docs/` and the epic's `discovery/` record; run anything that exists. A criterion
with no merged artefact is marked **unproven** even though the ticket that owns it is scheduled.

State of the epic at this SHA: **one of eleven children has landed** (22.2/#626, evidence-only), every other child
is open, ADR 0011 is still `Status: Proposed`, and no grammar, scanner, query, corpus or `.wasm` exists in the
repository (`git ls-tree -r origin/main | grep -Ei 'tree-sitter|grammar|\.wasm$'` returns only the epic's own
`_bmad-output/` markdown and `docs/adr/0011-…`).

## Per-criterion verdicts

| # | Done-when / acceptance clause | Verdict | Evidence |
|---|---|---|---|
| 1 | Independence: grammar, scanner, queries and corpus derive from `docs/spec`, never the runtime parser, its fixtures, real games or legacy source | **Partially proven — nothing to violate yet** | No grammar artefact exists. The only landed evidence is 22.2's record, which is markdown and cites `docs/spec` plus ADR 0011 only: `discovery/scanner-wasm-codegraph-routes.md` (the probe grammar is a toy language, explicitly not RPGCode). `git show --name-only 5f076e70` touches `_bmad-output/` only. |
| 2 | Incremental correctness: bounded scanner serialization, ambiguity/EOF/error recovery, full-vs-edit parity, native-vs-Wasm parity, UTF-8↔UTF-16 ranges including Windows-1252 text | **Unproven (prerequisite half proven)** | No scanner or grammar exists. The prerequisite — that an ABI-15 tree-sitter artifact with a C external scanner loads under the browser runtime *and* under the runtime CodeGraph vendors (web-tree-sitter 0.25.10) — is proven in `discovery/scanner-wasm-codegraph-routes.md` F-02…F-04. Owned by 22.3 (lexical/scanner) and 22.8 (release contract). |
| 3 | Grammar hazards: ASCII folding, logical lines, by-ref vs AND, `~=`/`!=`, destructor vs unary `~`, backtick XOR, `+` concatenation, left-associative power, commands as generic calls | **Unproven** | No grammar rules exist to inspect; the hazards are stated only in `docs/adr/0011-tree-sitter-rpgcode.md` §"Grammar boundary and hazards" and in the epic's clause 3. Owned by 22.3–22.7. |
| 4 | G1–G7: tools outside core; permissive licences and pinned ABI/toolchains; no runtime dependency, golden or hash movement | **Proven for everything that landed** | 22.2 added no dependency, lockfile entry, allowlist change, code or golden (`git show --name-only 5f076e70` → one `_bmad-output/` file); the toolchain versions and licences are recorded (tree-sitter CLI 0.25.10 MIT, Emscripten 6.0.13 Apache-2.0/LLVM/MIT-NCSA, web-tree-sitter 0.25.10/0.27.1 MIT); `packages/` holds no grammar package, and `pnpm graph`, `pnpm licence` and `pnpm provenance` were green on every PR that touched this epic today. |
| 5 | Useful partial trees: malformed/incomplete input keeps surrounding declarations usable through ERROR/missing nodes; consumers do not invent semantic resolution | **Unproven** | No parser output exists to test. Owned by 22.4 (recovery) and 22.8/22.11 (consumer checks). |
| 6 | All five grammar milestones have independently reviewed evidence | **Unproven** | Zero of five milestones are in the tree; the milestone table lives in the ADR. 22.3–22.7 own them. |
| 7 | The versioned release is consumed by both integrations | **Unproven** | No artifact, no query contract, no consumer wiring exists (22.8 → 22.9/22.10 open). |
| 8 | 22.11 records native/browser/edit, editor-host and extraction acceptance and G1–G7 verification | **Unproven** | 22.11/#635 is open and depends on 22.9/22.10. |
| 9 | Every child issue is done, every concrete blocker is resolved, and runtime golden/closing checks remain unchanged | **Unproven (goldens hold)** | Children: 22.2/#626 closed, 22.1, 22.3–22.11 open. The concrete blocker B-01 (CodeGraph third-party registration) is recorded in the 22.2 record but **not tracked as an issue** — see F-01. Runtime goldens and closing were unchanged on every branch this session (`pnpm golden` 24 compared, `pnpm closing` 8/8). |

## Findings

- **F-01 (evidence gap with a tracking gap, not a defect).** The epic's own instruction — "If the pinned tool lacks the
  required capability, track the concrete upstream/adapter prerequisite and leave 22.10 blocked until resolved" — is
  half done. The capability is proven absent and recorded (`scanner-wasm-codegraph-routes.md` F-05/F-06, blocker
  B-01, options and exit criteria), and 22.10's entry names the obligation ("Resolve the concrete capability/upstream
  blocker identified by 22.2 before starting implementation"), but there is **no tracked ticket** for the
  prerequisite itself, so the epic cannot show "every concrete blocker is resolved" progress. Filed as 22.12; its
  deliverable is the prerequisite record and the upstream request text, not code.
- **F-02 (contract question, no code yet, no defect).** Epic 22's clause 1 asks that expected trees be reviewed
  *before* implementation output. Nothing enforces or records that order today; it only exists as prose. That is
  acceptable while no grammar exists, and it is a 22.1/22.3 process obligation rather than a code gap — no ticket
  filed.
- **F-03 (withdrawal).** A candidate finding that "22.2 claimed a CodeGraph route it did not prove" is **withdrawn**:
  the merged record explicitly concludes the opposite (F-05/F-06: the artifact loads, registration does not exist,
  blocker B-01 with three options), and the epic permits a feasibility report as long as the prerequisite is tracked.
  The only real residue is F-01.

## Contract questions and their disposition

- **CodeGraph registration route** — decided by evidence, not by preference: 1.6.2 resolves grammars from a fixed
  filename map and `codegraph.json` only maps extensions onto supported languages. Options 1 (upstream registration
  feature) and 2 (our own adapter) need a written request with exit criteria before 22.10 can be refined. 22.12
  carries that.

## 22.1 / #625 — set aside, with a recommendation

22.1 is owner-gated (`hitl: true`, refine required). It must settle the syntax gaps and define the independent corpus
contract (rule/corpus ledger, file/dialect/range contracts) before 22.3 starts.

- **Recommendation.** Keep 22.1 as the single owner checkpoint and split its outcome into two artefacts it can land
  together: (a) a `docs/spec`-anchored rule ledger (one row per LEX/STX/EXP/*-ID with its normative anchor, and an
  explicit "gap" marker where the spec is silent), and (b) a corpus contract stating the case format, the review
  rule (expected tree reviewed against the case and the anchor before output), and the file/dialect/range
  conventions. Do not let 22.3 start on a subset of (a) without the checkpoint, because every later milestone
  inherits the ledger's shape.
- **Rejected alternative.** Let 22.3 start with a provisional lexical ledger and back-fill the statement/expression
  rows later. It unblocks work sooner, but the epic's independence criterion depends on the ledger being the oracle;
  a provisional ledger that later changes silently rewrites already-reviewed trees, which is exactly the failure the
  ADR exists to prevent.
- **What 22.3 would need from it:** the LEX rows with anchors, the corpus case format, and the confirmations for the
  hazards in Done-when 3 (notably ASCII folding and logical-line continuation).

## What this audit did not do

- It did not touch `docs/spec`, the ADR, any grammar artefact (there are none), or any owner-gated entry.
- It did not mark 22.1 or any milestone; it recorded the blockers those entries already own.
- It ran no full gate suite: the only merged artefact is a document, and the repository's gates were exercised on the
  PRs that produced it (`pnpm provenance`, `pnpm lint`, `pnpm graph`, `pnpm licence`, `pnpm catalogue:check`,
  `pnpm command-docs:check`).
