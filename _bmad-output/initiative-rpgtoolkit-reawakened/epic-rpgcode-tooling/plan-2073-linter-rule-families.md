---
title: 'Complete the RPGCode linter rule families'
type: 'bugfix'
ticket: 2073
created: '2026-11-12'
status: 'draft'
baseline_revision: '67387db6ae5f937138f30edd6aaf06cfb48b4393'
route: 'full'
route_source: 'pinned'
risk: 'high'
review: ''
review_source: ''
lenses_ran: []
review_loop_iteration: 0
context: ['docs/guardrails.md', 'docs/spec/engine/rpgcode-tooling.md', 'docs/spec/engine/rpgcode-language.md']
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Issue #2073 finds that the shipped linter omitted rule families promised by Epic 10, so authors cannot rely on its check to find those problems. **Approach:** Add conservative, configurable findings for unused names, unreachable statements, deprecated/obsolete commands and spec-backed style, using the same diagnostic model and reviewed baseline as existing rules.

## Boundaries & Constraints

**Always:** Derive behavior from `docs/` only; land any missing normative rule descriptions in their own commit before code (G7). Keep every existing rule and #2061's safe-code-action behavior. Report only facts supported by the supplied project and analysis; preserve dynamic calls, includes, closures, error handlers and external entry points. No automatic deletion or replacement of executable code. Apply the owner's under-one-second rule to each new unit test.

**Never:** Treat an incomplete editor buffer or missing include as proof a project has no uses; infer a style convention beyond TOOL-4; assume a deprecated command can be renamed without changing defaults or waits; claim the previously closed #945 met its missing acceptance.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|---|---|---|---|
| Unused local | Explicit function local is never read, captured, passed by reference, or called as a callable | `lint/unused-variable`, warning at its declaration | Conservative suppression where binding is ambiguous |
| Label | A function-scoped label has no possible reference, including dynamic branches/handlers | `lint/unused-label`, warning on its label token | Dynamic or unknown targets suppress the finding in that scope |
| Function | The author declares a complete project inventory, entry points and exports; every include resolves and no dynamic mechanism could name the definition | `lint/unused-function`, hint saying no static use was found in that project | Missing or ambiguous inputs make the rule unassessed, not evidence the function is unused |
| Control flow | An unconditional `return` or a demonstrably builtin `end()`, `done`, or `stop` makes a following statement unreachable and no label or error-resume path can enter it | `lint/unreachable-code`, warning on the statement | No report when a reachable jump, handler, fallible expression or overridden terminator can resume there |
| Catalogue | A call resolves to a catalogue entry tagged deprecated or obsolete | `lint/deprecated-command` or `lint/obsolete-command`, warning with that entry's replacement and reason | For a dynamic/overridden or method call not demonstrably the builtin, suppress; no rename fix |
| Style | Explicit TK3 source differs from TOOL-4 formatter output | `style/format`, hint with a safe formatter edit only when exact source/range is known | Unknown/TK2 dialect, failed parse and missing source are reported unassessed |
| Configuration | A new rule is set to `off`, an alternate severity or ignored range | Same validated project config, severity override and counted summary as existing rules | Bad config is reported, not ignored |

**Proposed input and assessment contract (owner approval required).** `tkr-lint.json` may declare a closed project by explicitly listing every program path, its `tk2`/`tk3` dialect, all external entry points and exports, and the effective package startup programs. The CLI verifies inventory paths, loads all programs and includes through a project loader, and cross-checks supplied package manifests; it never infers completeness from CLI arguments. Any missing input, unresolved include, opaque dynamic call/name or undeclared external entry makes affected rules unassessed. Function candidates are hints of no static use, not guarantees that runtime cannot reach them. Without this declaration, local rules still run and nonlocal rules are unassessed.

For standalone `check`, pass the explicit `--dialect tk3|tk2` argument to compilation and indexing, otherwise report dialect-dependent rules unassessed; do not use the formatter's default as evidence of dialect. Build project closure with `compileProgram` and its loader, using the declared root dialect; mixed-dialect include closures are unassessed because the compiler currently applies the root dialect to every unit. TK2 normalization changes source columns (`packages/core/src/script/tk2.ts:134-167,203-205`): emit a finding only when its original-source span is mapped and verified; otherwise mark that rule unassessed. Refuse TOOL-4 style rewrites for TK2. Per-file declarations in a closed inventory take precedence; conflicting declarations are configuration errors. #2074 owns conveying project dialect/config to the editor.

Extend `LintSummary` with `unassessed: readonly { file: string; rule: RuleId; reason: "missing-source" | "unknown-dialect" | "unsupported-dialect" | "unmapped-source-span" | "invalid-program" | "incomplete-project" | "dynamic-reference" }[]`; retain `disabledRules` and `ignoredRanges`. `#RPGCode(expr)` can evaluate code in the current scope, so affected local, label and function analyses are unassessed when its target is not provably bounded. The CLI's human output and `results.lint` expose all three; a run with unassessed rules must not present itself as fully checked. Document/version the result shape, its JSON schema and compatibility before implementation. The LSP displays findings and exposes unassessed state separately; absence of diagnostics is not a clean-project claim.

</frozen-after-approval>

## Code Map

- `_bmad-output/initiative-rpgtoolkit-reawakened/epic-rpgcode-tooling/tickets.toml:108-124` and `epic-rpgcode-tooling.md:31` are the approved breadth; `docs/spec/engine/rpgcode-tooling.md#tool-3` defines diagnostics, `#tool-4` the only proposed style source, and `#tool-6` the public index version promise.
- `packages/script-tools/src/lint.ts` owns rule table/config, catalogue lookup, severity and ignore handling; `rulesFor` currently indexes `RULES` by position. #2061 merged at `67387db6ae5f937138f30edd6aaf06cfb48b4393`: retain legacy warnings, only the proven-safe sigil edit, and its tests.
- `packages/script-tools/src/index-document.ts` constructs facts from compiled units; its index loses lexical scope and label references, `labelsOf` only visits top-level statements, and `calls` conflates methods, constructors and plain calls. Do not infer the new findings from those lossy fields alone. `packages/core/src/script/ast.ts` supplies scoped function/method/lambda bodies, label references and statement spans.
- `packages/core/src/script/command-docs.ts` projects tags, aliases, `replacedBy` and `reason`; the function spec marks `scan`, `mem` and `posture` deprecated but their catalogue metadata needs a complete audit. `rpgcode-language.md#keywords-and-structure` defines callable precedence, labels and captures; `rpgcode-errors-and-threads.md#err-1--the-handler-its-label-and-resumenext` controls handlers.
- `packages/script-tools/src/format.ts` requires an explicit TK2/TK3 dialect and defines safe formatter behavior. `packages/script-cli/src/commands/check.ts` currently passes independent sources with `resolveIncludes: false`; `packages/lsp/src/index.ts` builds an index for one document and #2074 owns LSP integration.
- `packages/script-tools/test/lint.test.ts`, `test/index.test.ts`, `test/baseline.test.ts`, `golden/lint-baseline.json` and `packages/script-cli/baselines/index.json` guard rules, index and dogfood. The published index schema is `docs/spec/schemas/tkr-script-index.schema.json`; changing its shape also requires schema/version, consumers and baseline review.

## Tasks & Acceptance

**Execution:**
- [ ] `docs/spec/engine/rpgcode-tooling.md` — rule descriptions, the exact inventory/dialect and assessment contracts above, project entry-point completeness and result-version migration; commit separately before implementation. Do not imply a single buffer or CLI path list is a complete project.
- [ ] `packages/script-tools/src/index-document.ts`, `lint.ts` and a focused analysis module — retain scope/call-kind and control-flow facts from the compiler's parsed units, or keep these facts internal; if any public index fields change, apply TOOL-6 minor versioning, update schema and affected public examples. Report unused locals/labels, conditional closed-project function candidates, provably unreachable statements, catalogue statuses and TOOL-4 style as above. Preserve exact source ownership and inclusive UTF-16 ranges across includes and deduplicate shared units.
- [ ] `packages/script-tools/src/lint.ts`, `index-document.ts` and linter tests — fix the reproduced #2077 arity false positives using the same call-kind and scoped callable resolution facts. A callable parameter `start()` and a user-defined `p->wav()` method must not be checked against builtin arity; genuine wrong-arity `start()` must still warn, and correct `wav("a.wav")` must stay clean. Cover callable overrides and effective plugin layers without suppressing unrelated genuine errors.
- [ ] `packages/script-tools/src/lint.ts`, `packages/script-cli/src/{args.ts,cli.ts,commands/check.ts,result.ts}`, `docs/spec/schemas/tkr-script-result.schema.json` and protocol docs/tests — implement the explicit inventory, entry-point, dialect and unassessed contracts; expose the same rule/suppression/skip state through the CLI and shared API. Respect TOOL-9's result compatibility/version rule; do not infer completeness from paths. Adding required `LintSummary.unassessed` is a public source-breaking API change: check registry availability and consumers, document migration and update consumer/type fixtures. If 1.x is published, coordinate a next-major release; otherwise settle the change before the first 1.0.0 release using #951's operator runbook. npm returned E404 on 2026-11-12, which does not rule out private access or another registry; #951's comment says publication was not yet performed at preparation time.
- [ ] `packages/core/src/script/catalogue-responders.ts` and relevant command metadata — compare every spec-marked deprecated/obsolete name with `commandDocumentation`; add missing supported metadata, including `scan`, `mem` and `posture` where confirmed, using only spec-backed replacement/reason text. No runtime change; run command-docs and catalogue gates.
- [ ] `packages/script-tools/test/lint.test.ts`, index and CLI tests — positive and negative tests per rule and config, including same-name locals, nested captures, callable parameters, indirect/computed calls, overloads, exports, file-qualified calls, missing includes, dynamic labels, handler/resume, builtin `end`/`done`/`stop` and overrides, aliases, TK2 `#RPGCode`, unmapped normalized TK2 spans, Unicode/CRLF spans, and compiler failures. Enumerate every actual `deprecated`/`obsolete` entry and alias in first-party and opt-in plugin catalogues, including effective overrides. Verify safe edits by reparse and behavior-preserving comparison where applicable.
- [ ] `golden/lint-baseline.json`, `packages/script-cli/baselines/` and tests — review each stock/authored finding and record only justified drift. Author a category-representative VEB-shaped fixture as interim proof, not proof of all ~160 templates. Preserve existing coverage.

**Acceptance Criteria:**
- Given each supported rule's positive and negative fixture, when lint runs with defaults or configured overrides, then its stable ID, severity, rationale, exact range and count are correct, and only proven-safe edits are offered.
- Given incomplete projects, dynamic/nonlocal uses, callable overrides or a potentially reachable statement, when lint runs, then it neither asserts unused/unreachable nor silently claims a skipped analysis ran.
- Given all registered deprecated and obsolete names and aliases, when a definitely builtin call is analysed, then its correct catalogue message is reported; normal builtins and possible non-builtin calls are not mislabeled.
- Given stock, authored and interim VEB-shaped fixtures, when checked, then the reviewed baseline matches and the interim fixture is clean; this is not proof of the missing template inventory or live builder output.
- Given #2074 has merged, when rebased and integrated, then LSP, CLI and CI expose the same new findings/config and distinguish unassessed analysis, while #2061 warnings have no unsafe fixes. Neither this ticket nor Epic 10 is complete until that cross-surface proof exists.

## Implementation Notes

## Plan Change Log

## Review Triage Log

Independent review found seven valid medium findings: closed-world inputs, CLI dialect propagation, #2074 completion gate, observable assessment/result schema, builtin terminators, TK2 dynamic execution/unmapped spans, and `LintSummary` public semver. All were incorporated above; the independent reviewer confirmed the last corrections and reported no remaining targeted-review blockers. The review did not run tests or builds.

## Design Notes

**Recommendations for owner approval:** (1) Only the project author may assert a complete static input set; candidate function findings remain hints rather than claims that runtime can never reach a name. This rejects assuming every CLI argument or open editor buffer is an entire game. (2) Restrict the first unreachable finding to proven control flow, not a naive scan after `return`; the latter misses labels and error-handler resume. (3) Use TOOL-4 indentation/canonical casing as the style rule and its formatter as the only rewrite source; do not invent preferences. (4) Report builtin status from actual metadata and never mechanically replace legacy audio commands, whose runtime defaults differ.

**VEB evidence gap and owner decision.** `docs/editor-features.md:133` names nine categories and an approximate count, not an enumerated template list. `research-what-survived-of-rpg-toolkit/legacy-ui-visual-archaeology.md:195-198` shows only a partial screenshot; issue #1707 is creator tests, not a VEB inventory. `epic-editor-p2/story-rule-visual-source-and-setup-delivery-contracts-plan.md:13-25` assigns the supported subset to the still-owner-gated #1744; #1746 owns category implementation. The 10.6 plan's assertion of a T-45 template list is therefore not established. **Recommend:** approve a clearly labeled, category-representative authored fixture as interim evidence while #1744 defines the supported inventory and #1746 proves generated output; keep full inventory/live-output acceptance unproven until then. **Alternative:** wait for #1744 before claiming any VEB evidence. This proposal requires owner approval; it does not waive or close the existing criterion.

## Verification

After approval and implementation, run each new focused behavioral test alone and inspect its reported duration; test all positives and negative counterexamples, then typecheck and lint. Fetch fixtures, run `pnpm test:strict`, author/fixture checks, `pnpm golden`, `pnpm golden:bun`, graph, licence, provenance, catalogue, command-docs, `closing`, and `pnpm script:dogfood`, plus the actual relevant `.github/workflows/ci.yml` commands. Independently review the final head, review any baseline drift and observe required GitHub CI before merge; rebase and re-review after #2074 or other main changes. Report unavailable platform/emulator checks rather than marking them green.
