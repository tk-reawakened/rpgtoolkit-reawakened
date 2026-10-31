---
type: discovery
title: "Inception proposal: epic-rpgcode-tooling (epic 10)"
date: 2026-10-31
baseline_revision: c1471b1734602f13bc77af64f1299af76c20c848
status: draft — awaiting owner approval; nothing published
amended: 2026-10-31 (section 12, the CodeGraph angle: draft breakdown 11 → 12 entries; corrected the same day — CodeGraph accepts new languages via contribution, so 22.10 is an upstream contribution and entry 4 is the semantic surface beside it)
---

# Inception proposal: RPGCode language tooling (epic 10)

Epic 10 is the last epic in this initiative that is un-incepted while every epic it declares as a prerequisite is finished. This document is the proposal for its breakdown. It publishes nothing: `tickets.draft.toml` in this folder is the draft, no `tickets.toml` exists, no GitHub sub-issue exists, and no code has been written.

## 1. Plain-language summary

Script authors currently get nothing from this project inside their editor: no squiggle when a program will not compile, no help while typing, no way to step through a program. Epic 10 gives them a normal modern language experience — errors and warnings as you type, help and completion from the same catalogue the engine runs, go-to-definition through `#include`, a formatter, a linter, a Jasmine-style test framework authors write in RPGCode itself, a debugger with breakpoints and stepping, and one command-line tool (`tkr script`) that runs all of it in a terminal and in CI.

The engine work those tools need is already on `main` (section 2). What is missing is the tooling itself, plus three small core seams (§2.3) — a source range, a read-only debug view, and a framing decision about where the shared library lives.

Two of the epic's twelve Done-when criteria need no work at all: the whole catalogue already resolves (criterion 3, asserted today) and "a test fails when a built-in has no help text" already holds (criterion 9's assertion half, in the command-docs gate). The breakdown therefore does not rebuild them; it consumes them.

## 2. Dependency verification, against live `origin/main` at `c1471b17`

### 2.1 The declared prerequisites are entry-complete

The initiative file declares `after = [{ epic = 3, … }, { epic = 4, … }]` for this epic
(`_bmad-output/initiative-rpgtoolkit-reawakened/tickets.toml:113-119`).

`uv run ~/.agents/skills/bmad-ticket/scripts/tickets.py --project-root . status …` against this worktree:

| Epic | Entries | State tally | Verdict |
|---|---|---|---|
| 3 `epic-rpgcode-vm` | 27 | `done: 27` | entry-complete |
| 4 `epic-board-rendering` | 37 | `done: 37` | entry-complete; closure audit merged as `c1471b17` ("mark epic 4 done after its closure audit (#922)") |

No entry in either epic is `planned`, `backlog`, `in-progress` or `review`. I read the entry states; I did not re-run their tests.

### 2.2 The breakpoint and step contract it builds on exists in `packages/core`

The contract is real and typed, not prose. Quoting `main`:

- `packages/core/src/ports/engine.ts:29-33` — the paused stop:
  ```ts
  /** Where a breakpoint stopped: thread, frame and source line (AD-1). */
  export type PausedState = {
    readonly thread: number;
    readonly frame: number;
    readonly line: number;
  };
  ```
- `packages/core/src/ports/engine.ts:35-38` and `:41-42` — breakpoints as data, and the two resume modes:
  ```ts
  export type Breakpoint = { readonly file: string; readonly line: number; };
  /** How an `advance` call resumes an open breakpoint tick. */
  export type ResumeMode = "continue" | "step";
  ```
- `packages/core/src/ports/engine.ts:92` — the resume parameter on `advance`:
  ```ts
  advance(ticks: number, inputs: readonly InputRecord[], maxTicks?: number, resume?: ResumeMode): TickReport;
  ```
- `packages/core/src/ports/engine.ts:113` — `setBreakpoints(breakpoints: readonly Breakpoint[]): void;`
- `packages/core/src/engine/engine.ts:2844-2871` — `runOpenThreads(mode)`, the open-tick cursor implementation: it snapshots the ready-thread list, steps the VM with `stepThread(active, state.vm, services, 1)` (`:2866`), returns `pauseAt(active, before)` when a breakpoint line is hit (`:2864`), and for `mode === "step"` pauses after exactly one instruction (`:2868-2872`).
- `packages/core/src/engine/engine.ts:2903-2911` — `advance` diverts to `finishOpenTick` whenever `state.engine.openTick !== undefined`, breakpoints exist, or `resume === "step"`, so a hit stops mid-tick and the next `advance` finishes that tick first.
- `packages/core/src/engine/engine.ts:2958` — `setBreakpoints(next) { breakpoints = next; }`.
- Tests that pin the behaviour: `packages/core/test/engine.test.ts:752` ("breakpoints stop inside a tick and continue to the uninterrupted hash"), `:767` ("breakpoints that never hit preserve every tick hash"), `:774` ("step resume executes one VM instruction and pauses again").

Epic 4's Notes and entry 4.30 (`done`) confirm the handoff: `pause`/`continue`/one-instruction `step` are core's; **step over, step in and step out are this epic's**, built from `step` plus the frame depth.

### 2.3 What this epic needs that does not exist yet

These are the real prerequisites epic 4 did not build. Each becomes an entry in §5 (F-numbers are cited from the entry descriptions).

| # | Missing | Evidence on `main` | Consequence |
|---|---|---|---|
| **F-1** | Source columns and end offsets | `Token` carries `line` only (`packages/core/src/script/lex.ts:18-25`); `SourcePos = { file; line }` (`packages/core/src/script/ops.ts:14`); every AST node carries `line` only (`packages/core/src/script/ast.ts`, e.g. `:18, :63, :173`); `Diagnostic = { code, file, line, message }` (`packages/core/src/ports/engine.ts:18-26`) | Diagnostics can highlight a whole line but not a token; hover at a caret and a formatter that preserves the text it does not own both need spans. Entry 3. |
| **F-2** | A read-only debug view on the `Engine` port | `packages/core/src/ports/engine.ts:98-114` has `advance`, `drawList`, `surfacePixels`, recovery members and `setBreakpoints` — no threads, frames, locals or globals accessor. Only the VM-only test host exposes state: `ScriptHost = Engine & { snapshot(); stateHash(); state(): GameState }` (`packages/runner-harness/src/script-host.ts:186-191`) | DAP `threads`/`stackTrace`/`variables`/`evaluate` have nothing to read. Entry 9. Also a breaking `Engine` contract change: four implementors — `packages/core/src/engine/engine.ts:2883`, `packages/runner-harness/src/script-host.ts:245`, `packages/runner-harness/src/double/test-engine.ts:48`, `packages/core/test/fixtures/ports/good.ts:583`. |
| **F-3** | Breakpoint stepping in the VM-only host | `ScriptHost.setBreakpoints` is a no-op (`packages/runner-harness/src/script-host.ts:306-309`) and its `advance(ticks, inputs, maxTicks?)` takes no `resume` (`:245`) | Not a blocker if the adapter drives `createEngine` (which does implement 4.30) — the plan does exactly that, so no hoist of `runOpenThreads` is needed. Recorded so nobody repeats the search. |
| **F-4** | A host loop that tolerates a pause | `runLog` throws when `report.paused !== null` (`packages/runner-harness/src/driver.ts:113-115`); the only request-answering loop is local to `packages/runner-harness/src/closing.ts:276-295` | The adapter owns a small driver (answer `asset`/`blob`/`playVideo`, pass `resume` through). Entry 9. |
| **F-5** | A native way for a built-in to call a script callable | `CommandView` (`packages/core/src/script/plugin.ts:72-119`) has no `call`/`invoke`; `CommandHandler` returns a `CommandResult` (`:167-171`) | `it("name", () => …)` cannot be a native built-in as written. Forces the test-framework placement decision D-5. |
| **F-6** | A spec page and an ADR for the tooling contracts | no `docs/spec/engine/rpgcode-tooling.md`; newest ADR is `docs/adr/0012-…`; the spec API adds commands to the catalogue, which G7 and ADR 0004 require to be written first | Entry 2 is doc-first and gates entries 4–10. |
| **F-7** | The LSP/DAP/tooling packages | `packages/` holds `core`, `synth`, `plugin-tk2-compat`, `runner-harness`, `runner-headless` only | Entries 1, 3, 7, 8, 9 create them. |
| **F-8** | The CI `changes` job Done-when 11 names | `.github/workflows/` contains `ci.yml` only and it has no `changes` job; `gh issue view 664` → `OPEN`, "Smart CI gates: run only the jobs a change needs" | The tool job lands in the existing `checks`+`gate` shape now; its path predicate waits for #664. Flagged, not assumed (D-7). |
| **F-9** | Publishable packages | `packages/runner-headless/package.json` and `packages/runner-harness/package.json` are `"private": true`, version `0.0.0` | Done-when 12 needs unpublishing, versions, a release pipeline and a compatibility statement. Entry 10. |

Not a gap, recorded as a conflict: Done-when 6 says "a visual-event-builder output lints clean (CAP-17)", but the VEB is CAP-17, owned by the future P2-tools epic, and epic 10 covers CAP-14 only. The criterion is served by a committed fixture built from T-45's template list; the live check runs when the VEB epic lands (D-6).

## 3. Done-when mapping, and what merged work already serves

### 3.1 Criteria 1–5 (the original envelope)

| # | Criterion | Deliverable over parser / IR / catalogue | Entry | Status today |
|---|---|---|---|---|
| 1 | LSP: diagnostics, hover, go-to-definition across includes, outline | `tokenize`/`parse`/`compileProgram` + `Program.notices` for diagnostics; `commandDocumentation()` for hover and call tips; `Program.files` / `fileKeys` (`packages/core/src/script/program.ts:99-115`) for go-to-definition across `#include` and `file.func`; `Program.functions`/`classes`/`labels` for the outline — all read through entry 4's index rather than re-derived | 1, 3, 4, 5 | **new** (diagnostics partly reachable already as `ScriptError` + `TickReport.diagnostics`) |
| 2 | A quick fix per legacy form of `rpgcode-dialects.md` that preserves behaviour | AST rewrite over the "Toolkit 2.x spellings a 3.1 reader may meet" table (`docs/spec/engine/rpgcode-dialects.md:57-69`) and the `#`/`#Include` frontend forms, re-parsed after each fix | 5 | **new** |
| 3 | The whole built-in catalogue resolves across the registered domains, asserted by a test | — | **none: already done** | **done**: `packages/runner-harness/test/corpus.test.ts:76` "verifyCatalogueCompleteness: all legacy and Reawakened catalogue names resolve", implementation `packages/runner-harness/src/corpus.ts:1219`. The breakdown adds no entry; closure should cite it. |
| 4 | A DAP session on `runner-harness`: breakpoint, step, threads, call stack, variables, in the `vscode.dev` web build | `Engine.setBreakpoints` + `advance(…, "step")` (exists) + the new `debugView()` projection (F-2); step over/in/out from the frame depth; `SceneInit.initialBoard` + `program` (`packages/core/src/engine/engine.ts:204-211`) is the fixture-launch seam | 10 | **partial**: the core contract exists (4.30); the adapter, the debug view and the web registration are new |
| 5 | The LSP ships as a VS Code and Open VSX extension build on its own, before the editor | `extensions/rpgcode/` (a thin client over `packages/lsp`) built and packaged in CI; publication is entry 11 | 1, 11 | **new** (`host-vscode` does not exist and waits on this epic) |

### 3.2 Criteria 6–12 (the 2026-10-25 scope expansion)

| # | Criterion | Entry | Already served |
|---|---|---|---|
| 6 | Rule-based linter, one diagnostic model, per-project config, VEB output clean | 6 | the registered arity and docs (`BuiltinSpec.params`, `BuiltinDoc.replacedBy`/`reason`), the dialect table and entry 4's symbol model are the rule inputs |
| 7 | Deterministic, idempotent, behaviour-preserving formatter (T-42, T-46) | 7 | needs F-1 spans |
| 8 | Jasmine-style spec framework in RPGCode, `*.spec.prg`, isolation, determinism, strict mode | 8 | the VM (`STEP_BUDGET`, injected clock/RNG), `createScriptServices`, `advanceScriptTick`, `Thread()`/waits are all landed |
| 9 | Help from one source; a test fails when a built-in has no help text | 3 (projection), 9 (`docs`) | **the assertion half is done**: `tools/command-docs/check.mjs` + `validateCommandDocumentation` (`packages/core/src/script/command-docs.ts:371`), which emits `doc.required`, `doc.summary`, `doc.behaviour` and `native.summary-mismatch`; wired in `.github/workflows/ci.yml:35-36` and `package.json` (`command-docs:check`, `command-docs:test`). The two-part AGENTS.md rule is structurally enforced by `summary` + `behaviour`. |
| 10 | One CLI (`tkr script`) with `check`/`fmt`/`test`/`docs`, stable exit codes, machine-readable output | 9 | the CLI *pattern* exists: `packages/runner-headless/src/index.ts:200` (`main(argv)` subcommand dispatcher) |
| 11 | Dogfooding on `stock/` and the authored fixtures, baselines committed like goldens, a path-gated CI job | 9 (+#664) | `stock/` holds three programs (`stock/stock_rpg/startup.prg`, `stock/stock_menu/…`, `stock/stock_battle/…`); the corpus gate (`ci.yml:106`, `golden/legacy-corpus.json`, `golden/spec-examples.json`) is the model for a committed baseline |
| 12 | A public headless harness: published semver packages, standalone CLI, JSON protocol, GitHub Action, other-runner recipe | 11 | `runner-harness` is Node-free (no `node:` import in `packages/runner-harness/src/*.ts`), so it is publishable to both Node and the browser as-is |

### 3.3 What the breakdown deliberately does not rebuild

- **The command catalogue and its gate.** `tools/catalogue/generate.mjs` + `catalogue:check` in CI (`ci.yml:33`) keep `packages/core/src/script/catalogue-stubs.ts` in step with the catalogue JSON; `commandDocumentation()` (`packages/core/src/script/command-docs.ts:191`) is the single projection of registration metadata. Entry 3 *consumes* both; no entry authors a second catalogue.
- **The corpus gate.** `dump --check` over `fixtures/legacy` and `docs/spec/examples` (`.github/workflows/ci.yml:106`) is the regression net every rewrite in entries 5 and 7 is measured against; no entry adds a parallel corpus.
- **`runner-harness`'s driver.** `runLog` (`packages/runner-harness/src/driver.ts:69-178`), `createScriptHost` with `state()`, `createMemoryLoader` (`src/corpus.ts:60`), the closing suite's request loop and `createNullAudio` are reused. Entry 10 adds a pause-aware sibling driver rather than changing `runLog` (it is a golden driver: F-4).
- **The help-text assertion.** No entry re-implements "every built-in has help"; entry 3 reuses `commandDocumentation()` and entry 9 emits Markdown/JSON from it.
- **Done-when 3.** No entry.

## 4. Decisions the owner must make

Each is a real fork in the plan. "Recommendation" is what the draft `tickets.draft.toml` assumes.

### D-1 — Transport and packaging of the LSP

- **Recommendation:** implement the LSP on the official `vscode-languageserver` + `vscode-languageserver-textdocument` libraries (MIT; pass G6), with `packages/lsp` exporting `createServer(connection)` exactly as AD-21 rules, and a separate stdio entry point in the same package. The connection is the only transport knowledge in the package; the stdio wrapper, the Worker wrapper and the MessageChannel wrapper are each three lines.
- **Rejected:** hand-rolled JSON-RPC framing over `Content-Length` headers. It is ~200 lines we would own forever, it will drift on cancellation, progress and `workspace/configuration`, and the browser client side (`vscode-languageclient/browser`) would still be an official dependency, so it buys nothing.
- **Consequences:** four new production dependencies (`vscode-languageserver`, `-protocol`, `-textdocument`, `vscode-languageclient`) must be added to the licence gate's production tree; `lsp` must not import Node, so the stdio wrapper lives behind a `bin` entry that is not on the package's public export (AD-22 keeps `src/index.ts` clean).

### D-2 — Early standalone extension, or fold into `host-vscode`

- **Recommendation:** ship the early extension from this repo as `extensions/rpgcode/` — a thin language client over `packages/lsp` — and publish it to the Marketplace and Open VSX as its own extension id. When `host-vscode` (epic 11) exists it either takes the same client over (one `activate` path, same server) or the early extension is deprecated in its favour; that decision belongs to epic 11, not here.
- **Rejected:** fold the LSP into `host-vscode` now. `host-vscode` does not exist, epic 11 `after` includes epic 10, and epic 11's `editor-ui` waits on this epic's tooling — folding would make Done-when 5 circular and delay the LSP by an epic.
- **Consequences:** two extension manifests can exist for a while, so their `contributes.languages` block must be shared from one file to avoid divergent `.prg`/`.rnc` registration; `ovsx` (EPL-2.0, already named as a G6 dev-tool exception) does the Open VSX publish.

### D-3 — Is the linter / formatter / test-framework scope in this epic or deferred

- **Recommendation:** keep it in. The 2026-10-25 owner decision widened the epic on purpose, criteria 6–10 are all in the envelope, and the linter, formatter, help projection and CLI share one library and one config file with the LSP — splitting them would move the seam rather than shorten the work.
- **Rejected:** defer criteria 6–8 and 12 to a second epic. Cost: a new epic envelope, a new `[[epic]]` edge, `covers` re-cut, and the LSP would ship a formatter-less, lint-less editor experience while the second epic waits behind it.
- **Consequence of keeping it:** the breakdown is 12 entries and two of them are high-risk (`8` spec framework, `11` publishing). **If the owner wants a smaller first epic**, the clean cut is: this epic keeps 1–7, 9, 10, 12 (LSP, lib, index, lint, format, CLI, DAP, sweep = 9 entries) and a new `epic-rpgcode-test-harness` takes entry 8 (spec framework) and entry 11 (public harness/publishing), with `after` on this epic and the same `covers = ["CAP-14"]`. That cut is a lane boundary: nothing in 1–7/9/10 imports `script-spec`, and the publishing entry is the only public-contract work. The index (§12) stays here either way, because the LSP and the linter read it.

### D-4 — `vscode.dev` web-build constraints

- **Recommendation:** treat the web build as a first-class target from entry 1, not a port later. That means: `lsp` and `dap` are host-agnostic packages with no Node import; the extension is a **web extension** (`browser` entry, `main` for desktop) that launches the server in a Web Worker via `vscode-languageclient/browser`; the adapter is registered with `DebugAdapterInlineImplementation`; asset and file access goes through the host (`vscode.workspace.fs`, i.e. a `ProgramLoader` supplied by the host, never `fs` inside `lsp`/`dap`).
- **Rejected:** a Node-only first version with a web port after the editor epic. It would let Node idioms into `dap`'s driver, and the `vscode.dev` requirement would then arrive as a rewrite of exactly the code the driver owns.
- **Consequences:** `runner-harness` is already Node-free (verified: no `node:` import under `packages/runner-harness/src/`), so the adapter can depend on it directly; CI must build the web bundle and run the browser LSP/DAP smoke test (AD-21's check), which needs a browser job — a new job next to `golden-bun`.

### D-5 — Where the shared tooling library lives, and whether the spec framework is built-ins

- **Recommendation, part 1 (placement):** a new transport-free package `packages/script-tools` (`@tk-reawakened/script-tools`) holding the diagnostic model, the linter, the formatter, the help projection and the JSON result protocol; `lsp`, `script-cli` and the editor hosts import it. Edges: `core ← script-tools ← {lsp, script-cli}`, `core ← runner-harness ← dap`, `core ← runner-harness ← script-spec`. This keeps `lsp` and `dap` as thin protocol adapters (AD-21) and honours G2's direction.
- **Recommendation, part 2 (spec framework):** the `describe`/`it`/`expect` API is an **RPGCode package** (`packages/script-spec`) — a `.prg` library plus one small native result channel — not a set of native built-ins. Under FUN-8 a plain-name call of a variable holding a callable already works, so `it(name, body)` can call its body and `expect(x).toBe(y)` can be a dictionary of callables. Only the *result record* (kind, case name, expected/actual, the current op's `SourcePos`) needs a native surface, because `CommandView` cannot call a callable (F-5).
- **Rejected, part 1:** put the tools in `core`. Purity permits it, but `packages.md` already names `lsp`/`dap` as the tooling packages, and adding lint/format to `core` bloats the shipped engine for every game to save one package.
- **Rejected, part 2:** ~20 native built-ins for the spec API. They would each need a `docs/spec` row and a catalogue entry (G7, the command-docs gate), `it` could not run its lambda without a new VM capability (F-5), and every shipped game would carry test commands in its catalogue.
- **Consequences:** the spec API needs its own spec page and an ADR (entry 2) because it adds commands to a new, test-only package; `script-spec` must be loadable only by the runner, never by a shipped game's manifest — enforced by a test that the engine default manifest does not contain it.

### D-6 — What "the VEB output lints clean" means before the VEB exists

- **Recommendation:** verify it against a committed fixture authored from T-45's template list ("about 160 command templates", `docs/editor-features.md:189`), and record the live check as CAP-17's obligation when the P2-tools epic lands.
- **Rejected:** leave the clause unverified until the VEB exists. It is a Done-when criterion; an unowned clause is how epics close with a red row.
- **Consequences:** the fixture is a golden-like artefact (G5 discipline) and the linter entry's `verify` cites it.

### D-7 — The CI path gate Done-when 11 assumes

- **Recommendation:** build the RPGCode tool job as a normal job wired into `gate` now, with no path predicate, and add the `changes` predicate when #664 lands. Do not widen this epic to own smart gates.
- **Rejected:** make #664 a prerequisite of this epic (`after` it) — it would block Done-when 11 on unrelated CI work with no owner, and it is not in this epic's `after`.
- **Consequences:** until #664 merges, a `.prg`-only PR still runs the full suite plus the new job; that is the current behaviour, so nothing regresses, and Done-when 11's "fast, relevant feedback" clause is satisfied only once #664 merges — a note for closure, not a blocker.

### D-8 — The CodeGraph angle: a parser-backed index now, or wait for the grammar route (added 2026-10-31)

Owner's angle: "some of the stuff with epic 10 could also be great with the codegraph stuff." Assessed in §12.

- **Recommendation:** Epic 10 builds the parser-backed symbol/reference/call index it needs anyway (entry 4) and exposes it as a **versioned JSON document** (`tkr script index --json`, plus a library call). Epic 22 keeps 22.10 and its grammar route unchanged; If 22.10 wants a cross-check, it may read the JSON artefact rather than re-extracting; Epic 10 adds no CodeGraph, tree-sitter or MCP dependency, and the Python `code-graph-rag` tool is rejected as an integration path (§12.2).
- **Rejected (a):** wait for the grammar registration prerequisite (B-01, option 1 upstream) before giving agents RPGCode symbol navigation. It leaves agents with no RPGCode facts for an unbounded upstream wait, while Epic 10 already has to build the symbol model for goto/outline and the linter.
- **Rejected (b):** have Epic 10 also emit tree-sitter/CodeGraph-shaped nodes and edges (a second extractor). That duplicates 22.10's extraction surface, forces a grammar dependency into the tooling lane, and would tempt the grammar work to use parser output, which ADR 0011 and G7 forbid.
- **Rejected (c):** move 22.10 into Epic 10. It would invert build order — Epic 22's grammar must exist before a grammar-based extractor can — and Epic 10 has no CAP-14 claim on querying CodeGraph's database.
- **Consequences:** entry 2 must rule the index schema and its stability promise (it becomes a public contract in entry 11); entry 9 gains the `index` subcommand; entry 4 is a new prerequisite of entries 5, 6 and 9; the epic grows from 11 to 12 entries. The scope note in §4/§12 keeps the index under CAP-14 and leaves the CodeGraph contribution in 22.10 (stage 1 syntactic, stage 2 the resolved edges entry 4 already has).

## 5. Proposed breakdown (12 entries, build order — amended 2026-10-31)

`M` = mechanical (a named transformation, one obvious shape). `J` = judgement (API names, rule semantics, packaging).

| # | Title | after | hitl | Risk | Kind | Lane |
|---|---|---|---|---|---|---|
| 1 | LSP tracer bullet: transport-free server, parser diagnostics over stdio, and the early extension | — | **yes** | medium | J | **A** LSP |
| 2 | Rulings: tooling contracts, the index schema, the diagnostic and rule model, ADR for the added commands | — | **yes** | high | J | **B** contracts |
| 3 | Source spans (columns, end offsets) and `script-tools`: one diagnostic model and the help projection | 2 (`3.29`) | no | medium | M+J | **B** |
| 4 | **RPGCode index: symbols, includes, call sites and event listeners as one versioned JSON schema** | 3 | no | medium | M+J | **H** index |
| 5 | LSP semantics and legacy-syntax quick fixes | 4 (`3.8`) | no | medium | J | **A** |
| 6 | Linter: rule table, project config, autofix, committed baseline | 4 (`3.21`, `3.29`) | no | medium | J | **C** analysis |
| 7 | Formatter: indent wizard and canonical capitalisation | 6 | no | medium | M+J | **C** |
| 8 | RPGCode spec framework: `describe`/`it`/`expect` pack, runner, `*.spec.prg` | 2 (`3.9`) | no | high | J | **D** test |
| 9 | `tkr script`: CLI, result protocol, generated reference, `index`, dogfooding CI job | 4, 6, 7, 8 | no | medium | J | **E** pipeline |
| 10 | Debug adapter: breakpoints, step over/in/out, threads, stack, variables, watches | 2 (`4.30`, `3.11`) | no | high | J | **F** DAP |
| 11 | Public harness and release: semver packages, standalone CLI, JSON protocol, GitHub Action, extension publish | 5, 9, 10 | **yes** | high | J | **G** release |
| 12 | Refactor sweep | 1–11 | no | low | M | — |

Entry 4 is new since the first draft (§12); ids 4–11 above were 4–10 before the amendment, renumbered because table order is build order and the index must precede its three consumers.

Lanes and parallel work (see §6 for the wiring):

- After entry 4, four lanes open at once: **A** (5), **C** (6), **D** (8) and **F** (10). They share no module: 5 edits `packages/lsp`, 6 edits `packages/script-tools/src/lint*`, 8 creates `packages/script-spec`, 10 creates `packages/dap` and the `Engine` port/engine files.
- Entry 4 is deliberately the single owner of the symbol model: 5 (goto/outline), 6 (unused/shadowing rules), 9 (`index --json`) and Epic 22's adapter all read it, and no entry re-derives symbols.
- 7 follows 6 by a *collision edge*, not a functional one: both add a module and a line to `packages/script-tools/src/index.ts` (and 6 owns the shared config file). Recorded as assumption A-1.
- 9 follows 4, 6, 7 and 8: `index`, `check`, `fmt` and `test` are those tools.
- 11 is last before the sweep: it packages what 5, 9 and 10 produced.

The trickiest entry is 8 (candidate for a checkpoint), then 10. Entry 2 is the one a person must read before anything else starts.

## 6. Cross-epic `after` wiring

| Entry | Pins | Why that entry |
|---|---|---|
| 3 | `3.29` | "Command documentation in code: a `doc` on every plugin command" — the projection is `commandDocumentation()` over exactly that metadata |
| 4 | `3.8` | "Modules: includes, implicit includes, redirects, hoisting, program cache" — go-to-definition across includes reads `Program.files`/`fileKeys` and the program cache |
| 5 | `3.21`, `3.29` | the linter's "unknown / wrongly-called built-in" rules need the registered parameter specs (3.21) and the docs metadata (3.29) |
| 7 | `3.9` | "Threads and waits: kinds, sleep, wake, tellThread, multiRun, tick budget" — case isolation and the deterministic run loop |
| 9 | `4.30`, `3.11` | 4.30 is the breakpoint/open-tick/step contract; 3.11 ("Snapshot and restore hardening") is what makes "a snapshot taken at the stop resumes" true |

The epic-level `after` in the initiative file stays as it is (epics 3 and 4, with 4.30 named). No entry needs an initiative-file change.

## 7. Why nobody is blocked

- Epics 3 and 4 are entry-complete, so entries 1, 2 and 3 can start the moment the owner approves; entry 3's only cross-epic pin (`3.29`) is `done`.
- Epic 11 (`epic-editor-foundation`) `after` includes epic 10 and is itself un-incepted; it is not waiting on a specific entry, only on this epic's tooling existing. Nothing in this breakdown adds scope to unblock it.
- Epic 9 (`epic-web-runner-packaging`) and epic 8 still have open entries of their own (battle 1 planned, menu 4 backlog), so epic 10 is not the critical path for them.
- Epic 22 (grammar, 10 planned) is deliberately not a dependency: this epic keeps semantic LSP/DAP ownership and uses the core parser, per the 2026-10-24 owner decision recorded in the envelope Notes.
- The three items that would block a *specific* entry are all inside this epic and earlier in the table: F-1 spans before 4 and 6; F-2 debug view before 9; the rulings in 2 before 4–10.

## 8. Assumptions, accepted risks, deferred scope

### Marked assumptions

- **A-1** Entry 6 follows entry 5 because both append to `packages/script-tools/src/index.ts`. If the owner prefers, 5 and 6 can run concurrently and the one-line barrel conflict is resolved at merge; only entry 6's `after` changes.
- **A-2** The early extension lives at `extensions/rpgcode/` in this repo and carries its own `package.json`; if `host-vscode` (epic 11) later owns the same id, the early extension is deprecated rather than renamed.
- **A-3** The CLI binary is `tkr` with a `script` subcommand (`tkr script check`), per the envelope's "working name `tkr script`". Renaming it later renames entry 10's published bin name, which is a breaking change for a public contract.
- **A-4** The spec framework's native surface is *one* result-channel command plus the package; if the owner rules for native `describe`/`it`/`expect` built-ins instead, the VM gains a callable-invoking capability and entry 2's rulings change materially.
- **A-5** "Deprecated legacy forms" means the rows of `docs/spec/engine/rpgcode-dialects.md:57-69` plus the eight obsolete names listed in `docs/spec/engine/rpgcode-functions.md` and the `BuiltinDoc.replacedBy` metadata — not the Toolkit 1.x dialect, which the spec keeps out of the first release.
- **A-6** Formatting is *source-text* formatting: it may re-indent and re-case, and it must not reorder statements, drop comments, or add a final newline the file did not have.

### Accepted risks

- **R-1** Adding `debugView()` to `Engine` breaks four implementors (F-2) and amends AD-1. Mitigated by making entry 9 the only entry that touches it, updating all four sites plus the port conformance fixture in the same change, and a test that `debugView()` does not change the state hash.
- **R-2** The formatter and the linter read the same config file. Two rc formats would be a permanent tax, so one file, owned by entry 5.
- **R-3** Publishing (entry 10) is a public contract. The compatibility promise must be written in entry 2's rulings, not discovered at release.
- **R-4** Twelve Done-when criteria in one epic is a large review surface; the sweep (entry 11) plus the closing evidence table in the epic Notes is how it stays auditable.

### Deferred out of this epic (with owner)

- The custom editors and webviews (epic 11), the tree-sitter grammar and syntax artifact (epic 22), package management (epic 19), and the VEB itself (CAP-17).
- T-41's full test-mode preferences (font, font size, message-window graphic) stay with the editor epics, as epic 4's Notes already rule; entry 9's fixture is a committed board plus program through `SceneInit`, not a T-41 UI.
- Toolkit 1.x dialect support (`docs/spec/engine/rpgcode-dialects.md:50-55`).

### Gaps flagged to the owner rather than papered over

- F-8 / D-7: the `changes` job (#664, open) that Done-when 11 names does not exist.
- Done-when 6's VEB clause (D-6) has no VEB to run against yet.
- Done-when 3 needs no work and should be marked satisfied at closure, not re-planned.

## 9. Check report

Mechanical (run on this worktree, at `c1471b17`): `tickets.py status` over a temporary `tickets.toml` converted from `tickets.draft.toml` — see §9.1. The file was renamed back immediately; `git status` shows no `tickets.toml` and no modified epic envelope.

### 9.1 Mechanical result

`tickets.draft.toml` copied to `tickets.toml` for one read-only `status` run, then removed (no `tickets.toml` exists now):

```
store = "repo"   folder = "epic-rpgcode-tooling"
counts = {"total": 12, "planned": 12}
refs   = 10.1 … 10.12
unpinned_after   = []
undeclared_after = []
order_conflict   = []
next_id = 12
longest_remaining_chain = ["10.2","10.3","10.4","10.6","10.7","10.9","10.11","10.12"]
```

No cycle, no `unpinned_after`, no `undeclared_after`, no `order_conflict`, no `drift`. `longest_remaining_chain` is the scheduler's longest path (docs ruling → spans → lint → format → CLI → publish → sweep), not a defect; it is the cost of the 7←6 collision edge (A-1); the amendment lengthened it by one link (3→4→6 instead of 3→6).

### 9.2 Set check (`references/validate-checks.md` — Set)

- **Coverage of every cited id:** the epic `covers` `CAP-14` only; every entry carries it and its description names the part it delivers (LSP semantics; quick fixes; lint; format; spec API; CLI; debug; publishing; spans/lib; rulings; sweep). Done-when 3 needs no entry (already asserted); Done-when 9's assertion half likewise (already gated). No capability outside CAP-14 is claimed (CAP-17's VEB clause is served by fixture, D-6).
- **Done-when reachability:** each of the twelve criteria maps to an entry in §3; criteria 3 and half of 9 are marked as already met with the file evidence.
- **Refactor sweep:** entry 11 waits on every other entry — present.
- **Tracer bullet:** entry 1 is the thinnest path through every layer this epic touches (core parser → transport-free server → stdio → extension → a squiggle a person can see), and it carries the one hitl step a person must do (install the VSIX and look).

### 9.3 Dependencies check (Set + Dependencies)

- **Real prerequisites only:** 3←2 (the model it implements), 4←3, 5←4, 6←4, 7←6, 8←2, 9←4,6,7,8, 10←2, 11←5,9,10, 12←all. Entry 7←6 is a *collision* edge on one file (A-1), documented, not hidden.
- **Collisions:** checked by module. `lsp` (5) / `script-tools` (3,4,6,7) / `script-spec` (8) / `dap`+`core` ports and engine (10) / `script-cli`+CI (9) / `extensions`+release (11) are disjoint; the only shared file is `packages/script-tools/src/index.ts` (3→4→6→7), resolved by the 7←6 edge.
- **Shared setup:** `packages/script-tools` and the diagnostic model have one owner (entry 3, the earliest that needs it); the symbol model has exactly one owner (entry 4 — 5, 6 and 9 read it, none re-derives it); the config file and the linter rule ids have one owner (entry 6); the fixture board/program used by 9 and 10 is authored by 8 (the test framework owns fixtures) and 10 reuses it.
- **Handoffs:** entry 3's `Analyse` output is consumed by 5, 6 and 9 — its description says so; entry 4's index is consumed by 5 (goto/outline), 6 (unused/shadowing) and 9 (`index --json`); entry 2's rulings are consumed by 5, 6, 7, 8, 9, 10 and it says which names, schema and exit codes it must settle; entry 10's `debugView()` is consumed only by 10.
- **Ledger-style checks:** no entry waits on a later table position; ids are 1–11 in build order; every cross-epic pin (3.8, 3.9, 3.11, 3.21, 3.29, 4.30) is `done` in its provider's `tickets.toml`.

### 9.4 Second pass (independent reviewer)

`task` subagent spawning is **disabled in this environment** ("Agent spawning is currently disabled"), so the independent review the skill asks for could not be delegated. I ran the second pass inline against `references/validate-checks.md` (Ticket, Set, Dependencies) and re-verified every file:line cited in this document by reading it. Findings fixed in this draft:

1. The first draft had a `dap` entry with `after = ["4.30"]` only, and a note about hoisting `runOpenThreads` out of `createEngine`. Reading `SceneInit` (`packages/core/src/engine/engine.ts:204-211`) showed the adapter can drive `createEngine` directly, so the hoist is unnecessary; the entry now pins `2` for the debug-view ruling and the hoist is recorded as a rejected option (F-3).
2. The first draft had a separate "spans" entry *and* a "debug view" entry, both touching `packages/core/src/ports/engine.ts`? No — spans touch `script/*`, the debug view touches `ports/engine.ts` and `engine/engine.ts`. Confirmed disjoint; no edge added.
3. The first draft put the spec framework *inside* `script-tools`, colliding with the linter and the formatter on the barrel. It is now its own package `packages/script-spec` (D-5), which also removes two collision edges.
4. The first draft's linter entry claimed "wrong arity" could be read from the parser. It cannot: arity lives in `BuiltinSpec.params` via the registry (3.21), so `3.21` is now pinned.
5. Done-when 3 was going to get an entry "assert the catalogue resolves". It already exists (`corpus.test.ts:76`), so the entry was deleted rather than duplicated.

A second human or agent read is still worth having on entries 7 and 9 — they are the two high-risk ones.

## 10. What approval changes, and the publish steps

On approval, and only then:

1. `tickets.draft.toml` → `tickets.toml` (nothing else in it changes).
2. Append the Notes block below to `epic-rpgcode-tooling.md`.
3. Run `tickets.py status <initiative folder>` and `next`; clear nothing unless it reports something.
4. Publish `[Epic 10]`'s children as native sub-issues on #666 and write each `tracker_id` back, per `references/board.md`.

Proposed Notes block (for the envelope, not written yet):

```markdown
- Inception (draft, 2026-10-31; awaiting owner approval): 12 entries in `tickets.toml`, evidence and reasoning in `discovery/inception-proposal.md`. Tracer bullet is entry 1 (core parser → `lsp` → stdio → early extension → a visible diagnostic). Decisions proposed: D-1 official `vscode-languageserver` libraries behind `createServer(connection)`; D-2 the early extension ships from `extensions/rpgcode/` and folds into `host-vscode` at epic 11; D-3 the linter, formatter and spec framework stay in this epic (a split boundary is offered in D-3); D-4 the web build is a first-class target from entry 1; D-5 the shared tooling library is a new `script-tools` package and the spec API is an RPGCode package with one native result channel, not a set of built-ins; D-6 the VEB-lints-clean clause is verified against a T-45-shaped fixture until CAP-17 lands; D-7 the tool CI job lands now and its path predicate waits for #664.
- Amendment (2026-10-31, owner's CodeGraph angle): a new entry 4 owns the one parser-backed symbol/reference/call index and a versioned JSON schema; `tkr script index --json` (entry 9) is its file surface. Division recorded against `#923` (`8df6503`): CodeGraph's syntax graph (Epic 22, 22.10, an upstream language contribution consuming the ABI-15 grammar; stage 1 = definitions, calls, explicit includes and class bases, stage 2 = implicit includes, `file.func` binding and listener literals) is syntactic and, at stage 1, blind to the resolution entry 4 already has; entry 4 is the semantic projection and is not a substitute for it nor superseded by it. The Python `code-graph-rag` tool is rejected as an integration path (native-from-source artefact, a third symbol model). Epic 10 adds no CodeGraph, tree-sitter or MCP dependency, and the index stays under CAP-14 because goto/outline and the linter need it anyway. Decision D-8; argument in `discovery/inception-proposal.md` section 12. Ids 4-10 renumbered to 5-11; 12 entries.
- Evidence: epics 3 (27/27) and 4 (37/37) are entry-complete; 4.30's contract is `packages/core/src/ports/engine.ts:29-42`, `:92`, `:113` and `packages/core/src/engine/engine.ts:2844-2871`. Done-when 3 is already asserted (`packages/runner-harness/test/corpus.test.ts:76`) and gets no entry; Done-when 9's "no built-in without help" assertion is already gated (`tools/command-docs/check.mjs`).
- Gap: F-1 source columns, F-2 a read-only debug view on `Engine` (breaks four implementors), F-4 no pause-aware driver, F-5 `CommandView` cannot call a callable, F-8 no `changes` job (#664 open), F-9 packages are `private`.
- Source conflict: Done-when 6 cites CAP-17 (the VEB) as its proof, and CAP-17 is not this epic's coverage. Served by a fixture (D-6); the live check is CAP-17's.
- Assumption A-1: entry 6 follows entry 5 only for `packages/script-tools/src/index.ts`.
```

## 11. Deferred list (for the epic's closure audit later)

- F-3 (breakpoint stepping in the VM-only `ScriptHost`): not needed by this plan; add it if a later epic wants to debug through `runner-harness` without `createEngine`.
- The CodeGraph transport: writing the index into CodeGraph's database, or an MCP surface over it, stays with Epic 22's 22.10 (see §12); Epic 10 stops at the JSON document.
- Index facts the grammar route can give and this one cannot: a file that does not compile yields a located diagnostic and no facts, and there are no syntax nodes for highlighting or a partial tree.
- The CI `changes` predicate (#664) once it lands.
- The live VEB lint check, when the CAP-17 epic lands.
- `host-vscode`'s takeover of the early extension's language client (epic 11).

## 12. Amendment (2026-10-31): the CodeGraph angle — one parser-backed index

The owner's angle: *"some of the stuff with epic 10 could also be great with the codegraph stuff."* Assessed below; the draft breakdown is amended in place (`tickets.draft.toml`, 12 entries). **Corrected on a second pass (§12.2):** CodeGraph does accept new languages through upstream contribution, and Epic 22 has already recorded that route in `#923` (`8df6503`) with a two-stage split; entry 4 is the semantic surface beside that syntax graph — not an alternative to it, and not superseded by it.

### 12.1 What Epic 10 has that CodeGraph and the agents querying it need

`docs/codegraph.md` measures CodeGraph as a TypeScript navigation tool over `packages/` (482 files, 10,899 nodes, 43,400 edges) and states plainly: **"No RPGCode support: this index does not parse `.rnc`/`.prg`."** So every question an agent asks about script behaviour today falls back to `rg` over the raw text. The facts an agent actually wants for that, against the core parser:

| Fact an agent asks for | Available today from `packages/core` | Where |
|---|---|---|
| Definitions: functions, their arity and their line | **yes** | `Program.functions: {[name]: FunctionInfo[]}` — `packages/core/src/script/program.ts:99-115`; `FunctionInfo {entry, end, params, labels, className?, access?}` — `packages/core/src/script/lower.ts:26-32`, so **arity is `params.length`**; the source line is on the AST `FunctionDef` (`packages/core/src/script/ast.ts:25-32`), not on `FunctionInfo` |
| Definitions: classes/structs, bases, members, methods, ctor/dtor | **yes** | `Program.classes`; `CompiledClass {name, bases, members, methods, constructor, destructor, abstract}` — `packages/core/src/script/lower.ts:42-50` |
| Definitions: labels, and their op index | **yes** | `Program.labels` — `program.ts:99-115` |
| Per-file definitions (for `file.func` cross-file calls) | **yes** | `Program.files`, `Program.fileKeys` — `program.ts:99-115` |
| The include graph (explicit and implicit) | **yes**, twice: resolved and syntactic | `ProgramRef.includes` (resolved, in order), `Ast.includes: IncludeRequest[] {path, line, implicit}` — `packages/core/src/script/ast.ts:243-259` |
| Call sites of built-ins and script functions, with arity and the `file.` qualifier | **yes**, from the compiled ops | `StepOp` `call {name, argc, file?, fileParam?, pos}` — `packages/core/src/script/ops.ts:121-132`, every op carrying `pos: SourcePos` (`ops.ts:14`) |
| Reference sites: reads, writes, member access, method calls, construction | **yes**, as ops | `load`, `declRef`, `storeRef`, `member`, `get_member_bound`, `methodCall`, `construct`, `load_fn`, `call_indirect` — `ops.ts:43-140` |
| Event listeners (`game.on("error", fn)`) | **derivable, not stored**: the event name is a literal argument at the call site, so it needs the AST (or a look-back over `push` ops) rather than a table | `Expr` `{kind: "call", name, args, file?, line}` — `packages/core/src/script/ast.ts:78-84`; `packages/core/src/events/` |
| Package start-up entry points | **yes** | `PackageStartupRef {owner, ref}` — `packages/runner-harness/src/script-host.ts:141`, surfaced through `ScriptHostInit.packageStartups` (`:163`); package catalogue `packages/runner-harness/src/package-catalogue.ts` |
| Load-time diagnostics per program | **yes** | `Program.notices: ProgramNotice[]` — `program.ts:90-97`; `TickReport.diagnostics` — `packages/core/src/ports/engine.ts:20-26` |
| **Source ranges (columns, end offsets)** | **no** — line only | F-1: `Token` (`script/lex.ts:18-25`), `SourcePos` (`script/ops.ts:14`), `Diagnostic` (`ports/engine.ts:18-26`) |
| A stable symbol identity (qualified name, kind, as-written vs folded spelling) | **no** | new, thin work over the tables above |
| A versioned JSON document and a CLI surface for it | **no** | new (entry 4 + entry 9) |

So roughly four fifths of the fact set an agent needs is already computed by the compiler and simply never leaves the process; the genuinely new work is **spans (already scheduled as entry 3), a name scheme, and an emitter**. That is why the answer to the owner's angle is "yes, and it is nearly free" rather than "a new feature".

Note the two facts the parser route cannot give: no facts for a program that does not compile (it throws a located `ScriptError`), and no syntax tree for highlighting or partial-file navigation. That is the grammar route's ground, not this one's.

### 12.2 Corrected: Epic 22 contributes the language upstream; entry 4 is the semantic surface beside it

The first version of this section repeated Epic 22's old blocker record ("B-01") as if CodeGraph were closed to new languages. **That was wrong, and Epic 22 has already fixed it in `#923` (`8df6503`, "docs(codegraph): record the language-contribution route (B-01)")**, which is the text this section now cites:

- The merged B-01 record replaces the "unbounded upstream feature request plus adapter fallback" framing with a **contribution checklist** (wiring files, extractor, resolver branch, vendored wasm, provenance doc, validation bar) and a **two-stage split**: *stage 1* is definitions, calls, explicit `#include` edges and class bases, in one extractor module plus one resolver branch; *stage 2* (out of the first PR) is implicit `file.func` includes, `file.func` binding and event-listener literal arguments.
- The **adapter is recorded as not recommended**, on the record and with its reason (writing CodeGraph's private SQLite schema for one consumer is a permanent reverse-engineering tax with no upstream). My earlier draft leaned on that adapter as the likely fallback; it no longer is.
- `docs/codegraph.md` now says CodeGraph 1.6.2 takes a new language "only by contribution … not through `codegraph.json`" and that "no adapter of ours is planned"; ADR 0011 names the contribution route as the consumer contract.
- 22.10 is reworded to "Contribute the RPGCode language to CodeGraph (stage 1)", with its honest-syntax-level claim promoted to the headline note. 22.12 records the route. The nine languages the contribution route has carried (CFML, COBOL, VB.NET, Erlang, Solidity, CUDA, Terraform, Nix, ArkTS) are named in the merge message, and the Scala case is kept as the cautionary precedent for **silent thinness** (node types wired, classes and calls emitted, no inheritance edges, imports resolving to nothing).

**The division to record.** Entry 4 and the contributed extractor answer different questions, and the two-stage split makes the boundary exact:

| Fact | CodeGraph syntax graph (Epic 22, 22.10 stage 1; stage 2 later) | Entry 4, the parser-backed index |
|---|---|---|
| Definitions (function, class, label) | yes, from the CST | yes, from `Program.functions`/`classes`/`labels` |
| Calls | yes, syntactic call sites | yes, bound as the VM binds them (compile-time built-in binding, R-35), with arity |
| Explicit `#include` edges | yes (stage 1) | yes, and **resolved** in order (`ref.includes`) plus `Program.files`/`Program.fileKeys` |
| Implicit includes and `file.func` binding | **stage 2**, through a resolver branch taught CodeGraph's semantics | yes today, through the compiler's own include/binding rules (MOD-2) |
| Arity | no (not in either stage's scope) | yes, `FunctionInfo.params.length` (`packages/core/src/script/lower.ts:26-32`) |
| Class bases | yes (stage 1) — and the record notes bases are core code, not extractor-only | yes, `CompiledClass.bases` (`lower.ts:42-50`), with the OOP-8 resolution walk |
| Literal call arguments (an `on("error", …)` listener) | **stage 2**, language-specific resolution CodeGraph does not have today | yes, `Expr.call.args` (`packages/core/src/script/ast.ts:78-84`) |
| Redirects in force at compile time | no | yes (`ProgramRef.redirects`) |
| Source ranges | yes | only after entry 3 (F-1) |
| A file that does not compile | indexed | **no facts**, a located diagnostic |
| Query surface | CodeGraph's SQLite graph, `codegraph_explore`/MCP, cross-language edges, agent retrieval | a JSON document and `tkr script index --json` |
| Provenance | `docs/spec` only (ADR 0011, G7) — the independent artefact | the engine's own compiler |

So: **entry 4 is the semantic surface; the contributed extractor is the syntactic one.** Entry 4 is not a substitute for the syntax graph (no syntax tree, no highlighting, no partial files, no graph queries, no TypeScript edges), and it is not superseded by it (arity, redirects and resolved binding are out of both stages, and stage 2's implicit-include work would re-teach semantics the compiler already owns). One thing I wrote earlier must be withdrawn: it is **not** true that a CST walk "can never" see resolved includes or literal arguments — stage 2 plans exactly that. The true statement is narrower and still decisive: entry 4 has those facts *today, from the compiler that will actually run the program*, with no upstream dependency, and stage 2's version would be a second teaching of the same semantics in a second codebase.

**The one-extractor rule, restated for the corrected route.** CodeGraph's extractor is written in CodeGraph's repository from the CST and is theirs; ours is a projection of the compiler and is ours. They are different artefacts with different owners, so there is no shared walker to duplicate. What we must not do is hand-write a *third* CST extractor of our own, and 22.10 must not consume entry 4 to build its extractor (ADR 0011's provenance rule). If 22.10 wants a cross-check, reading entry 4's JSON as an *oracle during validation* is the permitted use — a document, not an import, and not a source for the grammar, scanner, corpus or queries.

**The artefact split, named.** CodeGraph consumes a `.wasm` grammar under its bundled web-tree-sitter (the B-01 record pins CodeGraph 1.6.2 with web-tree-sitter **0.25.10** and our ABI-15 artefact loading under it; the investigation's "0.25.3" is not the figure this record carries, so this proposal does not adopt it). A grammar built from a source checkout is a native library, not that artefact. That matters because the *other* tool the owner linked, the Python **`code-graph-rag`**, consumes a native tree-sitter build from a source checkout and has no `.wasm`/web-tree-sitter path.

**Rejected: `code-graph-rag` (Python) as an integration path.** It is a second, unrelated indexer with its own graph and query surface; it wants a native grammar built from a checkout, so it cannot consume 22.8's artefact, and adopting it would mean a third symbol model beside CodeGraph's and entry 4's, plus a Python runtime in a TypeScript monorepo. Nothing in Epic 10 or Epic 22 should target it. If the owner wants it evaluated as a *user-side* option, that is documentation, not integration.

### 12.3 Is the index "the practical answer to the blocker"?

Partly, and precisely — and the correction above changes the framing, not the conclusion:

- **It answers the agents' need now.** An agent can read `index.json` (or `tkr script index --json`) and get, for any `.prg`/`.rnc` in the project, its functions with arity, classes with bases and members, labels, includes, call sites, references and listeners. Three of the navigation questions `docs/codegraph.md` benchmarked include "a script's calls", which this answers *better* than a syntactic index, because calls are bound the way the engine binds them.
- **It is not a substitute for CodeGraph.** No syntax tree, no graph traversal, no cross-language edges into the 43,400-edge TypeScript graph, no `codegraph_explore`, no MCP server. Agents get a document to query, not a graph engine.
- **It does not shorten the upstream route** (a contributed extractor plus a released CodeGraph build is still the only way to get RPGCode nodes into that graph), and it does not need to: the two answer different questions. It *does* keep agent navigation from waiting on a release, and it gives 22.10's contributor a cross-check oracle for what a correct RPGCode symbol/call set looks like once the base extractor exists.

### 12.4 Where it belongs: a new entry 4, not an amendment

- **Chosen:** a new entry **4 "RPGCode index: symbols, includes, call sites and event listeners as one versioned JSON schema"**, `after = [3]`, in a new lane **H**, before the LSP entry. Reasons: (a) it must precede its three consumers, and table order is build order; (b) it is a *fact layer* with its own verification (schema, stability, no fabrication on a broken file), which entry 3's diagnostic model is not; (c) it is the "one index owner" the LSP, linter and CLI share, so entry 5 and 6 now `after` it instead of re-deriving symbols.
- **Rejected: fold into entry 3.** Entry 3 is spans + the diagnostic model + the help projection; adding the symbol/reference model makes one entry own two schemas and three consumers' needs, and blurs the line between "is this text valid" and "what does this text mean".
- **Rejected: fold into entry 9 (`tkr script`).** The CLI is thin by design and its lane is decided by the linter and formatter; putting the index there would make the LSP (entry 5) and the linter (entry 6) either duplicate the walk or wait on the CLI, inverting the dependency.
- **Not ours to change: 22.10.** It is being rescoped by Epic 22 itself (adapter → upstream language contribution, §12.2), its `after` and exit criteria are built on the grammar, and its provenance rule is part of that epic's acceptance (22.11). Nothing in this amendment edits 22.10; what we record is the *boundary*: the syntactic graph is theirs, the semantic projection is ours. Putting a runtime-parser dependency inside the grammar epic remains the one thing ADR 0011 forbids, so 22.10 must not consume entry 4 to build its extractor.

### 12.5 Scope: it stays under `covers = ["CAP-14"]`, with a note

CAP-14's letter is "language tooling in any LSP/DAP client". The index is not a client, so the honest framing is not "agents get a new capability" but: **the index is how CAP-14's go-to-definition, outline and lint rules are computed**, and `tkr script`'s machine-readable output (Done-when 10) is the surface that exposes it. The CodeGraph transport is 22.10's, under Epic 22 — no capability id moves, and none is invented.

Proposed scope note for the envelope at approval:

> Scope note (2026-10-31): the symbol/reference index (entry 4) is CAP-14's data — the LSP's go-to-definition and outline and the linter's rules read it — and `tkr script index --json` (entry 9) is its machine-readable surface, within Done-when 10. Writing those facts into CodeGraph, or serving them over MCP, is Epic 22's 22.10 (blocker B-01); this epic adds no CodeGraph, tree-sitter or MCP dependency and no second symbol walker.

### 12.6 Effect on the schedule

- **Count:** 11 → 12 entries. Ids 4–10 became 5–11; the new index is 4; the sweep is 12. Nothing is published, so renumbering is free.
- **Edges:** `3→4`, and `5←4`, `6←4`, `9←4`; `11←5,9,10` (was 10←4,8,9). No cross-epic pin is added — the index needs nothing from Epic 22, which is the point.
- **Longest chain:** `2→3→6→7→9→11→12` (7 links) becomes `2→3→4→6→7→9→11→12` (8 links), because the linter now also waits on the index. The DAP lane (10) is unaffected and still opens straight after the rulings.
- **What still runs in parallel:** unchanged — after entry 4, lanes A (5), C (6), D (8) and F (10) run concurrently; the index adds one short serial step, not a new bottleneck.
- **D-3 split option:** it gets *better*. The 12-entry epic's clean cut is now: this epic keeps 1–7, 9, 10, 12 (LSP, contracts, spans, index, lint, format, CLI, DAP, sweep = 9 entries) and a new `epic-rpgcode-test-harness` takes entry 8 (spec framework) and entry 11 (public harness/publishing), `after` this epic, `covers = ["CAP-14"]`. The index stays here either way, because the LSP and the linter need it.

### 12.7 Entry-level diff of the draft

| Draft v1 | Draft v2 (amended) | Change |
|---|---|---|
| — | **4 RPGCode index** (new) | new entry; owns the one symbol/reference/call walk and the versioned schema; `after = [3]` |
| 4 LSP semantics and quick fixes | 5 | `after` 3→4 (reads the index) |
| 5 Linter | 6 | `after` gains 4 (unused/shadowing rules read the index) |
| 6 Formatter | 7 | id only; collision edge 7←6 kept (A-1) |
| 7 Spec framework | 8 | id only |
| 8 `tkr script` | 9 | gains the `index` subcommand and its verify; `after` gains 4 |
| 9 Debug adapter | 10 | id only |
| 10 Public harness / release | 11 | `after` 4,8,9 → 5,9,10 |
| 11 Refactor sweep | 12 | `after` 1–10 → 1–11 |
| — | 2 (description) | also rules the index schema and its stability promise |
