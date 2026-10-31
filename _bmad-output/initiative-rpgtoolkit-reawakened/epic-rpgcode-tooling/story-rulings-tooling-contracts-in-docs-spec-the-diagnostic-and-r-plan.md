---
title: "Rulings: tooling contracts in docs/spec, the diagnostic and rule model, and an ADR for the added commands"
ticket: 2
status: blocked
blocked_reason: awaiting the owner review of the ruling text recorded here
---

## Intent

Entry 10.2 is the epic's doc-first gate (G7 rule 4): it writes the normative text that entries 10.4 to 10.11 implement, so no builder invents an API name, a rule id, a subcommand, an exit code or a schema. This plan records the exact wording the owner is asked to approve, decision by decision (D-1 to D-8 from `discovery/inception-proposal.md` §4), with the file each paragraph lands in, its evidence, the rejected alternative, and the entries that change if the owner rules the other way.

Nothing here is written into `docs/` yet. Every paragraph below is marked **Proposed ruling (pending owner review; entry 10.2)** with no owner name and no date, so approval can be recorded against the text as it stands.

## Where the text lands

| File | What it carries | Created by 10.2? |
|---|---|---|
| `docs/spec/engine/rpgcode-tooling.md` | the whole tooling contract: the diagnostic model (D-1), the lint rules (D-3), the formatter rules (D-4), the spec API (D-5), the index schema (D-6), the CLI surface (D-7) | new page |
| `docs/adr/0013-rpgcode-spec-package.md` (working number; renumber if 0013 is taken when 10.2 runs) | why the spec API is a test-only RPGCode package with one native result channel, and how its commands enter the catalogue (G7, ADR 0004) | new ADR |
| `docs/spec/engine/rpgcode-functions.md` | one row per command the spec package registers, in the existing table shape, so the command-docs gate validates them | edited |
| `docs/guardrails.md` | **only if** the owner approves the D-2 note that the LSP/DAP libraries ship inside our own artefacts (no rule text changes are proposed today) | unchanged unless ruled |
| `docs/adr/0011-tree-sitter-rpgcode.md` | **only if** a grammar decision moves; no paragraph below proposes one | unchanged |
| `_bmad-output/…/architecture-…/architecture-…md` | an amendment note on AD-1 (the read-only debug view, D-8) | edited |

`package.json`, any `tsconfig`, and any source file stay untouched: entry 10.2 is a docs entry, and its verify is that the commit touches `docs/` and the epic folder only (plus the spine's AD-1 note).

## D-1 — Transport and packaging of the LSP

**Proposed ruling (pending owner review; entry 10.2).** The language server is built on the language-server libraries (`vscode-languageserver`, `vscode-languageserver-protocol`, `vscode-languageserver-textdocument`, and `vscode-languageclient` for the host side of the early extension), each MIT and therefore acceptable under G6; the package `packages/lsp` exports exactly `createServer(connection)` and knows no transport, with the stdio entry point kept out of its public export, and the connection is supplied by each host: stdio in the desktop extension, a worker connection under `vscode-languageclient/browser` in the web build, an in-memory or `MessageChannel` pair elsewhere. Those four libraries, with their transitive `vscode-jsonrpc` and `vscode-languageserver-types`, are the complete addition to the licence gate's production tree, and nothing else may be added by the tooling packages without a new ruling.

- **Evidence:** AD-21 already rules `createServer(connection)` and the three transports; the epic's Boundaries name transport-free `lsp`/`dap`; G6 admits MIT.
- **Files:** `docs/spec/engine/rpgcode-tooling.md` (a "Packages and transport" section), plus the licence note if the owner wants the dependency set written down outside the spec.
- **Rejected:** hand-rolled JSON-RPC framing. It is roughly 200 lines we would own forever and it drifts on cancellation, progress and `workspace/configuration`, while the browser client remains an official dependency anyway.
- **If ruled otherwise:** 10.4 gains the framing work and its transport tests; 10.1's tracer is unaffected (it uses whatever connection it is given); 10.11 publishes a differently shaped package.

## D-2 — The early standalone extension

**Proposed ruling (pending owner review; entry 10.2).** The early extension ships from this repository as `extensions/rpgcode/`, a thin language client over `packages/lsp` with its own extension id, built to a VSIX in CI and published to the Marketplace and to Open VSX (the second with `ovsx`, already the repository's named dev-tool licence exception). It registers `.prg` and `.rnc` and nothing else, contributes no editor feature of its own, and declares the same `contributes.languages` block from one shared file so that the later full host cannot diverge from it; when the editor host exists it either takes over this client or supersedes the extension, and that decision belongs to the editor epic.

- **Evidence:** Done-when 5; AD-21; `docs/architecture-options.md` §4.1 (publish to both registries); G6's dev-tool note for `ovsx`.
- **Files:** `docs/spec/engine/rpgcode-tooling.md` (an "Early extension" note).
- **Rejected:** folding the language client into the editor's VS Code host now. That host does not exist, its epic waits on this one, and folding would make Done-when 5 circular.
- **If ruled otherwise:** 10.1 loses its packaging step and its hitl approval step; 10.11 loses the registry publication; Done-when 5 moves to the editor epic.

## D-3 — The diagnostic and lint-rule model

**Proposed ruling (pending owner review; entry 10.2).** One diagnostic shape serves the parser, the linter, the language server, the CLI and CI: a code, a severity (`error`, `warning`, `info`, `hint`), a source range, a message, the rule id when a lint rule raised it, and an optional fix expressed as a text edit over a range. Lint rules carry a stable id of the form `<area>/<rule>` in lower-case with hyphens, a default severity, a one-line rationale and, where a rewrite is safe, an autofix; a project configures them in one file per project with per-rule severities and an ignore list, and a project that configures nothing gets the defaults. Rules are never silently suppressed: a disabled rule or an ignored range is reported by the CLI's `check` summary.

- **Evidence:** Done-when 6; the existing `Diagnostic { code, file, line, message }` (`packages/core/src/ports/engine.ts:20-26`) is the runtime shape the model extends, and `BuiltinDoc.replacedBy`/`reason` (`packages/core/src/script/builtins.ts:87-106`) supply the deprecation facts.
- **Files:** `docs/spec/engine/rpgcode-tooling.md` (the model and the config file).
- **Rejected:** a second, linter-only diagnostic type. The epic's premise is that one model feeds the server, the CLI and CI; two shapes would need a translation layer whose only job is to lose the rule id.
- **If ruled otherwise:** 10.3's model, 10.6's rules and 10.9's reporters change together; 10.5's code actions change shape.

## D-4 — Formatter rules

**Proposed ruling (pending owner review; entry 10.2).** The formatter is a source-text rewrite with two jobs: re-indent by brace depth, with a configurable indent width (default four spaces, the shipped samples' width) and one statement per line, and normalise built-in names, keywords and the reserved literals to their canonical lower-case spelling, leaving string contents, map keys written as strings, comments and labels' spelling alone. It is idempotent (formatting formatted text is a no-op), behaviour-preserving (a run before and after formatting gives the same state hash), and it never reorders statements, drops a comment, joins a continued line, or adds a final newline a file did not have.

- **Evidence:** T-42 and T-46 (`docs/editor-features.md`); LEX-10 folds names by ASCII lower-casing; the corpus gate gives the before/after oracle.
- **Files:** `docs/spec/engine/rpgcode-tooling.md` (a "Formatting" section).
- **Rejected:** an AST-printing formatter (parse, then print). The parser discards whitespace and comments irrecoverably, so a printer would delete comments — the one thing T-42/T-44 never did.
- **If ruled otherwise:** 10.7 changes scope, and 10.9's `fmt --check` exit code semantics change with it.

## D-5 — The RPGCode spec API and its packaging

**Proposed ruling (pending owner review; entry 10.2).** The spec API is an RPGCode package, not a set of native built-ins: `packages/script-spec` ships a library program plus one native command that records a spec result (case name, kind, expected, actual, and the source position the VM already knows), and the package defines `describe` (nestable), `it`/`test` whose body is a callable it calls, `beforeEach`/`afterEach`/`beforeAll`/`afterAll`, `expect` with `toBe`, `toEqual`, `toBeTruthy`, `toBeNull`, `toContain`, `toBeCloseTo`, `toThrow` and `.not`, and `skip`/`only`. A skip fails the strict run; `only` narrows the run and warns. The package is loadable only by the test runner: it must not appear in the engine's default manifest, and a test asserts that.

- **Evidence:** FUN-8 already resolves a plain-name call of a variable holding a callable (`docs/spec/engine/rpgcode-language.md`), so `it(name, body)` needs no new VM capability; `CommandView` cannot invoke a callable (`packages/core/src/script/plugin.ts:72-119`), so one native channel is the irreducible part; G7 and ADR 0004 require the commands to be specified before they exist.
- **Files:** `docs/adr/0013-…` (the decision and the alternative), `docs/spec/engine/rpgcode-tooling.md` (the API), `docs/spec/engine/rpgcode-functions.md` (the one new command's row).
- **Rejected:** about twenty native built-ins. Each needs a spec row and a catalogue entry, `it` could not run its lambda without a new VM capability, and every shipped game's catalogue would carry test commands.
- **If ruled otherwise:** 10.8 changes materially, `docs/spec/engine/rpgcode-functions.md` gains about twenty rows, and 10.9's `test` subcommand talks to a different runtime.

## D-6 — The index document

**Proposed ruling (pending owner review; entry 10.2).** `tkr script index` emits one JSON document under a versioned schema: for each program, its reference, its functions (name as written, folded name, arity, line), classes with bases, members and methods, labels, the include edges it resolved (explicit and implicit, in order), the files it reached, its call and reference sites with name, arity and position, and the event names its listeners name literally; plus a diagnostics list, so a program that did not compile is reported and given no invented facts. Additive fields may appear in a minor version; removing or retyping a field is a major version. The document is the whole surface this epic publishes for other tools: writing it into a code graph, or serving it over a protocol, is not this epic's work.

- **Evidence:** the fact set and its gaps in `discovery/inception-proposal.md` §12.1 (with file:line); the division against CodeGraph's contribution route in §12.2 (Epic 22, #923 / `8df6503`: stage 1 syntactic, stage 2 implicit includes and listener literals); and why the grammar route is not duplicated.
- **Files:** `docs/spec/engine/rpgcode-tooling.md` (a "Machine-readable index" section with the field list and the versioning rule).
- **Rejected:** every tool reading the compiler in process. That is what the LSP, the linter and the CLI would each do, and it is why the index has one owner; and emitting tree-sitter or graph nodes here would duplicate Epic 22's extractor and tempt the grammar work to use parser output, which ADR 0011 forbids.
- **If ruled otherwise:** 10.4 shrinks to an internal helper, 10.9 loses `index`, and the CodeGraph cross-check disappears.

## D-7 — The CI tool job, before and after #664

**Proposed ruling (pending owner review; entry 10.2).** Until the smart-gates change (#664, still open) gives the pipeline a `changes` job with path outputs, the RPGCode tool job runs unconditionally as its own job, in the `gate` job's `needs`, and runs in this order: build, then `tkr script check` over `stock/` and the authored fixtures, then `tkr script fmt --check` over the same set, then `tkr script test` over the packages' own spec files, each comparing against the committed baselines and failing with the file and rule or case named. When #664 lands, the job's only change is its condition — it gains `needs: changes` and `if: needs.changes.outputs.rpgcode == 'true'`, with the `gate` job taught that an intended skip is a pass — and its steps and baselines stay as they are.

- **Evidence:** `.github/workflows/ci.yml` today has `checks`, `unit` (sharded), `golden`, `golden-bun` and `gate`, and no `changes` job; `gh issue view 664` reports it open. Done-when 11 requires the path-gated behaviour, which therefore has an owner outside this epic.
- **Files:** `docs/spec/engine/rpgcode-tooling.md` (a "Dogfooding in CI" section), and `CONTRIBUTING.md` if the owner wants the local commands beside the existing checks.
- **Rejected:** making #664 a prerequisite of this epic. It would block a Done-when criterion on unrelated CI work that no epic of this initiative owns, and it is not in this epic's `after`.
- **If ruled otherwise:** 10.9 loses its CI job and Done-when 11 moves to whichever epic ends up owning smart gates; the baselines and the commands stay.

## D-8 — The read-only debug view

**Proposed ruling (pending owner review; entry 10.2).** The engine exposes one additional read-only projection, `debugView()`, returning plain data: the tick, and per thread its id, kind and status, the wait it is parked on, and its frames from outermost to innermost, each with the program reference, the instruction pointer, the source line and the function name, plus the frame's locals and the global table as name/value pairs. It never writes state, allocates no payload when unobserved, and a call leaves the state hash unchanged. It is the only seam a debug adapter reads; the adapter computes step over, step in and step out from the frame depth it sees between one-instruction resumes, so the core gains no new stepping mode.

- **Evidence:** `packages/core/src/ports/engine.ts:98-114` has no such accessor, while `packages/core/src/script/state.ts:93-160` already holds frames, locals and thread status; 4.30 supplies `setBreakpoints` and the one-instruction `step`; `ScriptHost.state()` (`packages/runner-harness/src/script-host.ts:186-191`) is the test-host precedent but returns the whole versioned state.
- **Files:** `docs/spec/engine/rpgcode-tooling.md` (the view's shape) and the architecture spine's AD-1 note that the engine API gains this projection.
- **Rejected:** exposing `GameState` from `Engine` instead. It would let a debugger read and, through a shared reference, mutate the versioned state, and it couples the debugger to every section's shape rather than to one projection.
- **If ruled otherwise:** 10.10 changes shape (it would read the whole state or a different projection), and the AD-1 note is not written.

## Effect on 10.3 to 10.12 if a decision is reversed

| Decision | Entries that change |
|---|---|
| D-1 | 10.4, 10.11 |
| D-2 | 10.1, 10.11 |
| D-3 | 10.3, 10.5, 10.6, 10.9 |
| D-4 | 10.7, 10.9 |
| D-5 | 10.8, 10.9, and `rpgcode-functions.md`'s row count |
| D-6 | 10.4, 10.9 |
| D-7 | 10.9 (and the epic's closure evidence for Done-when 11) |
| D-8 | 10.10, plus the AD-1 note |

## Verification

The entry's own check runs when it starts, not now: the commit touches `docs/` and the epic folder only; every ruling above appears marked "Proposed ruling (pending owner review; entry 10.2)" with an evidence line and a rejected alternative; the new spec page's anchors resolve; `docs/spec/engine/rpgcode-functions.md` gains exactly the rows D-5 names; `pnpm provenance` and `pnpm lint` pass; and a person can plan 10.3 to 10.12 from the page without inventing a name, rule id, exit code or schema field.

## Why this plan is blocked

It is a doc-first entry whose whole deliverable is the ruling text, and that text is the owner's to approve. The proposal's D-1 to D-8 are recommendations; publishing them into `docs/spec` before the owner rules would record a decision nobody made. The blocker clears when the owner answers the eight paragraphs above — approve as written, amend, or reject with a reason — after which this plan's `status` returns to normal and the entry writes the files listed in the table.
