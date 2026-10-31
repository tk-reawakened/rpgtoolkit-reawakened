# RPGCode tooling: language server, linter, formatter, spec API and command line

This page is the contract for the tooling that reads RPGCode without running it: the language server, the linter, the formatter, the spec (test) API, the machine-readable index, the debug view and the `tkr script` front end. Every rule here was **approved by the owner on 2026-10-31** and is implemented by epic 10.

The language the tools read is in [rpgcode-language.md](rpgcode-language.md); its built-ins are in [rpgcode-functions.md](rpgcode-functions.md); the runtime failures a diagnostic mirrors are in [rpgcode-errors-and-threads.md](rpgcode-errors-and-threads.md). Nothing here changes what a program does at run time: a tool may report, rewrite or explain, and the engine's behaviour is the same before and after.

<a id="tool-1"></a>
**TOOL-1 Packages and transport.** The language server is the package `lsp`, which exports exactly `createServer(connection)` and knows no transport. Each host supplies the connection: stdio in the desktop extension, a worker connection under `vscode-languageclient/browser` in the `vscode.dev` build, and an in-memory or `MessageChannel` pair in tests and in the standalone editor. The stdio entry point is a program binary and is not part of the package's public export, so importing the package can never open a pipe.

The libraries the server is built on are `vscode-languageserver`, `vscode-languageserver-protocol`, `vscode-languageserver-textdocument` and, on the host side of the early extension, `vscode-languageclient`; with their transitive `vscode-jsonrpc` and `vscode-languageserver-types` they are the complete addition to the production dependency tree of the shipped artefacts. All are MIT and acceptable under [G6](../../guardrails.md). Nothing else is added without a ruling recorded here.

The debug adapter is the package `dap`, which depends on `runner-harness` (the platform-neutral half of the headless runner) and never on Node; on the web it registers as a `DebugAdapterInlineImplementation`. Dependency direction is the guard-rails' `core ← synth ← runner-*/lsp/dap/editor-ui ← host-*` ([G2](../../guardrails.md)), unchanged by this page.

<!-- OWNER: D-1, approved 2026-10-31. Rejected: hand-rolled JSON-RPC framing — about 200 lines owned for ever, drifting on cancellation, progress and workspace/configuration, while the browser client is an official dependency anyway. -->

<a id="tool-2"></a>
**TOOL-2 The early extension.** Until the editor exists, the language server ships in its own extension, `extensions/rpgcode/`: a thin language client over `lsp` with its own extension id, built to a VSIX in CI and published to the Visual Studio Marketplace and to Open VSX (`ovsx` is the repository's named dev-tool licence exception in [G6](../../guardrails.md)). It registers `.prg` and `.rnc` and contributes no editor feature of its own; the `contributes.languages` block is one file shared with any later host, so the two registrations cannot diverge. When the editor host exists it either takes this client over or supersedes the extension, and that decision belongs to the editor epic.

<!-- OWNER: D-2, approved 2026-10-31. Rejected: folding the client into the editor's VS Code host now — that host does not exist, its epic waits on this one, and folding would make the extension requirement circular. -->

<a id="tool-3"></a>
**TOOL-3 One diagnostic model.** One diagnostic shape serves the parser, the linter, the language server, the CLI and CI:

| Field | Meaning |
|---|---|
| `code` | the stable failure or rule code, lower-case with dots for a failure (`syntax.error`) or `<area>/<rule>` for a lint rule (`lint/unused-variable`) |
| `severity` | `error`, `warning`, `info` or `hint` |
| `range` | start and end position in the source, in **UTF-16 code units of the decoded source** — lines 1-based, columns 1-based inclusive — so a range slices the text exactly ([TOOL-3 range convention](#tool-3-range-convention)) |
| `message` | one sentence a game author can act on |
| `rule` | the lint rule id when a rule raised it, absent for a parser diagnostic |
| `fix` | optional: one or more text edits over ranges, each with the rule that produced it |

A diagnostic from the engine's own run is the same object with its `pos` mapped to a range, so a script error seen in the editor and one seen in CI are the same shape. The range is exact: a diagnostic about a token starts at that token's first character and ends after its last.

Lint rules carry a stable id of the form `<area>/<rule>`, a default severity, a one-line rationale and, where a rewrite is safe, an autofix. A project configures them in one file per project — per-rule severity and an ignore list — and a project that configures nothing gets the defaults. A rule is never silently suppressed: `check` reports the count of disabled rules and ignored ranges in its summary.

<!-- OWNER: D-3, approved 2026-10-31. Rejected: a linter-only diagnostic type — the premise of this page is that one model feeds the server, the CLI and CI; two shapes would need a translation layer whose only job is to lose the rule id. -->

<a id="tool-4"></a>
**TOOL-4 Formatting.** The formatter is a source-text rewrite with exactly two jobs: re-indent by brace depth, with a configurable indent width (default four spaces), and normalise built-in names, keywords and the reserved literals to their canonical lower-case spelling. It leaves string contents, map keys written as strings, comments and label spelling alone.

It is **idempotent** — formatting formatted text is a no-op — and **behaviour-preserving** — a run before and after formatting gives the same state hash. It never reorders statements, drops a comment, joins a continued line, or adds a final newline that the file did not have. A file whose last line has no newline keeps it that way ([PRG-2](rpgcode-language.md#programs-and-encodings)).

<!-- OWNER: D-4, approved 2026-10-31. Rejected: an AST-printing formatter (parse, then print) — the parser discards whitespace and comments irrecoverably, so a printer would delete comments, the one thing the legacy indent and cleanup wizards never did. -->

<a id="tool-5"></a>
**TOOL-5 The spec API.** RPGCode programs can be tested in RPGCode. The API is a package, not a set of engine built-ins: `script-spec` ships a library program and one native command, `specResult`, which records a result and the source position the VM already knows. The package defines the names below; a program that wants them includes or loads the package, and a shipped game never does.

| Name | Shape | Meaning |
|---|---|---|
| `describe(name, body)` | nestable | a group of cases |
| `it(name, body)` / `test(name, body)` | `body` is a callable called with no arguments | one case |
| `beforeEach` / `afterEach` / `beforeAll` / `afterAll` | `body` callable | hooks around the cases in the enclosing `describe` |
| `expect(actual)` | returns a matcher object | assertions listed below |
| `expect(actual).not` | the negation of every matcher | |
| `toBe`, `toEqual`, `toBeTruthy`, `toBeNull`, `toContain`, `toBeCloseTo`, `toThrow` | chained on the matcher object | see below |
| `skip` / `only` | prefix a case or a `describe` | run control |

`toBe` compares strictly, `toEqual` compares by value (numbers, strings and arrays element-wise), `toBeTruthy` applies the engine's own truth test ([R-39](rpgcode-language.md#compatibility-notes)), `toBeNull` passes for the unset value, `toContain` searches a string or an array, `toBeCloseTo` takes an optional tolerance and `toThrow` takes a callable and passes when it raises a runtime error. A failure message shows expected against actual and the source line of the failing assertion.

The runner discovers `*.spec.prg`, runs each case on a fresh fixture (board, party and variables) under the injected clock and the seeded RNG, so two runs of the same spec file give identical results and identical state hashes. A skipped case fails the strict run; `only` narrows the run to the marked cases and warns that it did. The package is loadable only by the test runner: it must not appear in the engine's default manifest, and a test asserts that it does not.

The commands this page adds to the catalogue are listed in [rpgcode-functions.md](rpgcode-functions.md#reawakened-additions-not-part-of-the-282-legacy-catalogue) (`specResult` and the package's public names).

<!-- OWNER: D-5, approved 2026-10-31. Rejected: about twenty native built-ins — each would need a spec row and a catalogue entry, `it` could not call its lambda without a new VM capability, and every shipped game's catalogue would carry test commands. -->

<a id="tool-6"></a>
**TOOL-6 Machine-readable index.** `tkr script index` writes one JSON document describing the programs it was given:

| Field | Contents |
|---|---|
| `schema` | `tkr-index/<major>.<minor>` |
| `programs` | per program: its reference, its functions (name as written, folded name, arity, line), classes with bases, members and methods, labels, the include edges it resolved (explicit and implicit, in order), the files it reached, its call and reference sites (name, arity, position), its literal event-listener names and its package start-up entry points |
| `diagnostics` | the [TOOL-3](#tool-3) diagnostics, so a program that did not compile is reported and given no invented facts |

**Stability promise.** Adding an optional field, or adding a value to an enumerated field, is a minor change; removing a field, retyping it, renaming it, or changing the meaning of an existing field is a major change. A consumer may rely on every field above; it may not rely on the order of members inside an object, on whitespace, or on fields not listed here.

The document is the whole surface this epic publishes for other tools. Writing it into a code graph, or serving it over a protocol, is not this page's contract: the syntactic graph a code-graph tool builds from its own grammar is separate work, and the two must not be confused — this index is the compiler's own semantic view, that graph is a syntax view ([ADR 0011](../../adr/0011-tree-sitter-rpgcode.md)).

<!-- OWNER: D-6, approved 2026-10-31. Rejected: every tool reading the compiler in process — that is what the server, the linter and the CLI would each do, and it is why the index has one owner; and emitting grammar or graph nodes here would duplicate the independent extractor and tempt the grammar work to use parser output, which ADR 0011 forbids. -->

<a id="tool-7"></a>
**TOOL-7 Dogfooding in CI.** This repository runs its own tools on its own RPGCode. The tool job executes, in this order: build, then `tkr script check` over `stock/` and the authored fixtures, then `tkr script fmt --check` over the same set, then `tkr script test` over the packages' own spec files — each comparing against the committed baselines and failing with the file and the rule or case named. The baselines are committed and reviewed like goldens ([G5](../../guardrails.md)).

Until a change classifier exists in the pipeline, the job runs unconditionally and is part of the required `gate`. When the classifier lands, the job's only change is its condition: it gains a dependency on the classifier and an `if:` that runs it only when RPGCode files changed, with the gate taught that an intended skip is a pass. Its steps and its baselines do not change.

<!-- OWNER: D-7, approved 2026-10-31. Rejected: making the CI classifier a prerequisite of the tooling — it would block the dogfooding requirement on unrelated pipeline work that no epic of this initiative owns. -->

<a id="tool-8"></a>
**TOOL-8 The read-only debug view.** The engine exposes one projection for debuggers, `debugView()`, returning plain data:

| Field | Contents |
|---|---|
| `tick` | the tick the view was taken in |
| `threads` | per thread: `id`, `kind`, `status`, the wait it is parked on (kind and remaining ticks) and its frames |
| `frames` | outermost to innermost: the program reference, the instruction pointer, the source line and the function name |
| `locals` | the innermost frame's variables as name/value pairs |
| `globals` | the global table as name/value pairs |

The view is **copied out, never aliased to the live frames or tables**: mutating anything it returns cannot change the VM, and a call leaves the state hash unchanged. It is the only seam a debug adapter reads. Step over, step in and step out are computed by the adapter from the frame depth it sees between one-instruction resumes ([THR-3](rpgcode-errors-and-threads.md#thr-3)), so the engine gains no new stepping mode beyond the breakpoint contract in [AD-1](../../../_bmad-output/initiative-rpgtoolkit-reawakened/architecture-rpgtoolkit-reawakened/architecture-rpgtoolkit-reawakened.md).

<!-- OWNER: D-8, approved 2026-10-31. Rejected: exposing the whole game state from the engine — it would let a debugger read and, through a shared reference, mutate the versioned state, and it couples the debugger to every section's shape rather than to one projection. -->

<a id="tool-9"></a>
**TOOL-9 The command-line front end.** The tool is one binary, `tkr`, and RPGCode tooling is its `script` group: `tkr script check`, `fmt`, `test`, `docs` and `index`. Later groups (`tkr run`, `tkr pack`) may follow without renaming anything.

| Subcommand | Reads | Writes |
|---|---|---|
| `check` | `.prg`/`.rnc` sources and the project config | nothing |
| `fmt` | the sources it is given | the sources, unless `--check` is passed |
| `test` | the project's `*.spec.prg` files | a report file only when one is asked for |
| `docs` | the catalogue and `docs/spec` | the generated quick reference and language reference, to a path or stdout |
| `index` | the programs it is given | the [TOOL-6](#tool-6) document, to a path or stdout |

Every subcommand accepts `--json`. With it, the envelope below goes to stdout and human-readable progress to stderr, in both success and failure.

**Exit codes.** Stable and public once published; a code is never reused for a different meaning.

| Code | Meaning | `check` | `fmt` | `test` | `docs` | `index` |
|---|---|---|---|---|---|---|
| `0` | nothing to report | no diagnostic at the failure severity | nothing would change (with `--check`) | every case passed, or was skipped outside strict mode | the committed reference matches | the document was written |
| `1` | findings in the project | a diagnostic at the failure severity | at least one file would change | at least one failing case, or a skip under strict mode | the generated reference differs from the committed one | — |
| `2` | usage or configuration error | unknown subcommand, bad argument, missing path, unreadable or invalid project config — nothing is written | the same | the same | the same | the same |
| `3` | internal error | the tool itself failed unexpectedly — never for a program's content | the same | the same | the same | the same |

**The JSON envelope.** One shape for every subcommand and both outcomes:

```json
{
  "schema": "tkr-script-result/1",
  "tool": "tkr",
  "subcommand": "check",
  "status": "findings",
  "exitCode": 1,
  "diagnostics": [],
  "summary": { "files": 0, "diagnostics": { "error": 0, "warning": 0, "info": 0, "hint": 0 }, "changed": 0, "passed": 0, "failed": 0, "skipped": 0 },
  "results": {}
}
```

`status` is `ok`, `findings` or `error` and agrees with `exitCode`. `diagnostics` carries [TOOL-3](#tool-3) objects themselves — the same objects the language server publishes, so a CI job and an editor see one shape. `results` holds the subcommand's own payload: the changed paths for `fmt`, the cases with expected and actual for `test`, the written path or a drift list for `docs`, and the [TOOL-6](#tool-6) document for `index`. The schema is [schemas/tkr-script-result.schema.json](../schemas/tkr-script-result.schema.json); a test validates every subcommand's `--json` output against it.

**Stability promise.** Adding an optional field or an enumerated value is a minor change; removing, retyping or renaming a field, or adding or repurposing an exit code, is a major one.

<!-- OWNER: D-9, approved 2026-10-31. Rejected: one non-zero code for everything — a CI job or a wrapper could then not tell "your script has a warning" from "your config is broken" from "the tool crashed", which is the distinction --strict and --fix workflows turn on; and a per-subcommand envelope would mean two schemas to version for one contract. -->
