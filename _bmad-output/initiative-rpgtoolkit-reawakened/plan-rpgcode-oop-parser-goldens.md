---
title: "Authored object-oriented RPGCode parser goldens"
type: discovery
created: '2026-10-18'
status: built
baseline_revision: f212728587894ad87ae94de67ae14e31cb444a36
route: full
route_source: auto
risk: medium
review: quick
review_source: pinned
lenses_ran: [quick]
review_loop_iteration: 0
context:
  - docs/guardrails.md
  - docs/spec/engine/rpgcode-language.md
  - docs/spec/engine/rpgcode-modules-and-objects.md
---

> **Store note (2026-10-31).** This document was written as a plan for the authored OOP parser goldens that merged
> in `e9525922` (2026-10-18), before the ticket breakdown existed; it carries no entry id because no entry owns it —
> epic 18's parser entry is `&name`/anonymous methods, epic 19's are the rulings and the dictionary/class runtime, and
> epic 22 deliberately forbids deriving grammar from the runtime parser or AST fixtures. It is therefore reclassified
> as a discovery record rather than being attached to a guessed entry, and `tickets.py` no longer reports it as a
> plan whose ticket names nothing.

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Small object tests exist, but there is no readable parser golden corpus covering realistic collection, GUI composition and inheritance patterns. Archived programs suggest useful feature combinations, not known-passing TK3.1 expectations; the framework is LGPL.

**Approach:** Independently author four small programs from normative docs and pair them with reviewed semantic AST expectations. Exercise the real lexer/parser through the existing Node test suite. These are parser-contract goldens, not original-engine or runtime-parity goldens.

## Boundaries & Constraints

**Always:** Implement from docs/spec only; retain high-level pattern selection, not archived names, algorithms or method bodies. Cite fixture provenance. Preserve signatures, visibility, bases, operators, expression grouping and reference/call distinctions in readable expectations. Exercise the committed inputs in a direct smoke.

**Never:** Copy/translate LGPL code; commit original games; claim original-engine execution; change runtime semantics or implement first-class functions. Do not pin known failures of otherwise valid legacy forms such as returnMethod references/conversion declarations as negative acceptance criteria. Document that boundary; no skipped/expected-failure tests.

## I/O & Edge-Case Matrix

| Scenario | Input | Expected parser meaning |
|---|---|---|
| Collection | Overloaded constructors, typed helper, member array, operator[], operator=, destructor and concrete caller | Exact signatures, indexed assignment and reference-return target retained |
| GUI-style objects | Widget/Caption inheritance, private fields, accessors, override and callers | Receiver/member calls and visibility retained; no graphics assets needed |
| Class graph | Multiple direct bases, arity overloads and pure virtual declaration | Ordered bases and separate signatures retained; no runtime diamond-order claim |
| References/composition | By-reference arguments, return &global/member/index, nested calls | Writable reference targets distinct from ordinary values; no lifetime claim |
| Malformed input | Missing closing brace and malformed declaration | Located syntax error; do not compare incidental message prose |

</frozen-after-approval>

## Code Map

- `packages/core/src/script/parse.ts`: real token-to-AST parser; `ast.ts` defines declarations, bodies, parameters, bases and byRef returns.
- `packages/core/src/script/lex.ts`: use the full-language scanner path used by compileProgram, not tokenize's older construct-rejection mode. Core tests may import the internal helper; no new public export is required.
- `packages/core/test/script-frontend.test.ts`, `script-objects.test.ts`: reuse Node test/assert conventions, but place corpus checks in a separate test.
- `packages/core/test/fixtures/carray-like.prg`: authored collection precedent; do not duplicate its runtime checks.
- `docs/spec/engine/rpgcode-language.md#keywords-and-structure`, `rpgcode-modules-and-objects.md#objects`: normative fixture sources.
- `CONTRIBUTING.md`: fixture/golden provenance and deliberate update guidance.

## Tasks & Acceptance

**Execution:**
- [x] `packages/core/test/fixtures/parser-oop/{collection,widgets,inheritance,references}.prg` — independently authored four compact source fixtures with concrete top-level callers and spec/provenance comments.
- [x] Matching `*.ast.json` files — reviewed readable semantic expectations, retaining all nodes and removing only source-line bookkeeping.
- [x] `packages/core/test/script-oop-goldens.test.ts` — four corpus comparisons, focused reference/grouping/base-order assertions and malformed-input code/location checks; six tests pass.
- [x] `CONTRIBUTING.md` — documents authored provenance, parser-only scope, command and manual golden-review policy.

**Acceptance Criteria:**
- Given each valid fixture, when the real lexer/parser runs, then the result matches the reviewed expected signatures, visibility, bases, bodies, operators and reference flags.
- Given malformed source, when parsing runs, then a located syntax diagnostic is produced without weakening valid-fixture coverage.
- Given a regression that changes a reference return, argument grouping or base order, when the corpus comparison runs, then the changed meaning causes a useful failure rather than passing merely because parsing succeeds.
- Given the suite runs repeatedly from repository root, when no recording is requested, then expectations remain unchanged and comparisons are deterministic.

## Implementation Notes

- Implemented in isolated `test/rpgcode-oop-parser-goldens` worktree. No production parser/runtime changes, archived source reuse or dependency additions.
- Final direct Node smoke compared all four fixtures through the built lexer/parser. Mutating a reference return, base order and argument grouping each caused the intended golden mismatch.
- Final verification: typecheck, test, lint, provenance and licence passed. Full suite: 1150 tests, 1131 passed, 19 skipped because fetched legacy fixtures were absent, zero failures. Targeted suite: six passed, zero skips.
- Initial implementation used an invalid async node:fs declaration and over-filtered literal-zero statements; both were removed before final verification. Temporary working-directory mistakes were corrected; unrelated main-checkout edits were preserved.

## Plan Change Log

## Review Triage Log

| Finding | Verdict | Route and resolution |
|---|---|---|
| Corpus had no top-level example callers | medium | Patch: added explicit calls and reviewed expected statement trees in all four fixtures. Existing body call sites were useful, but standalone coverage is now explicit. |
| Focused test did not assert nested argument grouping | medium | Patch: added nested source call and exact grouped-argument assertion from the committed fixture; direct source mutation confirms detection. |

- Parent review also removed semantic filtering beyond source lines, pretty-printed expectations, corrected URL-based fixture loading and removed a misleading reference-limitation comment. All final checks ran after these changes. Nothing deferred.

## Design Notes

Successful-node line numbers are excluded so comments/blank lines do not redefine parser meaning; negative tests separately preserve error-location coverage. This is a parser contract, not a complete TK3.1 oracle. Any discovered valid documented syntax defect must be reported and addressed through the bug/spec workflow, not hidden by narrowing fixtures or blessing rejection. Runtime class checks, GC and save behavior are outside this task.

## Verification

- `pnpm build`, then `node --test packages/core/test/script-oop-goldens.test.ts`: build and targeted suite pass.
- Direct disposable Node invocation over all four source/expectation pairs: observe parser behavior outside the test runner, then remove smoke scaffolding.
- `pnpm typecheck && pnpm test && pnpm lint && pnpm provenance && pnpm licence`: test compilation, regressions and configured gates pass after implementation/review changes settle.
- Review each golden against normative syntax and intended meaning; no copied library code or original-engine execution claim.
