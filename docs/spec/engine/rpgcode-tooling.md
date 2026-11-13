# RPGCode tooling: language server, linter, formatter, spec API and command line

This page is the contract for the tooling that reads RPGCode without running it: the language server, the linter, the formatter, the spec (test) API, the machine-readable index, the debug view and the `tkr script` front end. Every rule here was **approved by the owner on 2026-10-31** and is implemented by epic 10.

The language the tools read is in [rpgcode-language.md](rpgcode-language.md); its built-ins are in [rpgcode-functions.md](rpgcode-functions.md); the runtime failures a diagnostic mirrors are in [rpgcode-errors-and-threads.md](rpgcode-errors-and-threads.md). Nothing here changes what a program does at run time: a tool may report, rewrite or explain, and the engine's behaviour is the same before and after.

<a id="tool-1"></a>
**TOOL-1 Packages and transport.** The language server is the package `lsp`, which exports exactly `createServer(connection)` and knows no transport. Each host supplies the connection: stdio in the desktop extension, a worker connection under `vscode-languageclient/browser` in the `vscode.dev` build, and an in-memory or `MessageChannel` pair in tests and in the standalone editor. The stdio entry point is a program binary and is not part of the package's public export, so importing the package can never open a pipe.

The libraries the server is built on are `vscode-languageserver`, `vscode-languageserver-protocol`, `vscode-languageserver-textdocument` and, on the host side of the early extension, `vscode-languageclient`; with their transitive `vscode-jsonrpc` and `vscode-languageserver-types` they are the complete addition to the production dependency tree of the shipped artefacts. All are MIT and acceptable under [G6](../../guardrails.md). Nothing else is added without a ruling recorded here.

The debug adapter is the package `dap`, which depends on `core` for the `Engine` port and on `runner-harness` (the platform-neutral half of the headless runner) for the scene it drives, and never on Node; on the web it registers as a `DebugAdapterInlineImplementation`. It adds no third-party dependency: the Debug Adapter Protocol it speaks is a small typed subset of messages, so the length-prefixed framing is thirty lines this page owns rather than a library, and nothing here needs a ruling. Dependency direction is the guard-rails' `core ← synth ← runner-*/lsp/dap/editor-ui ← host-*` ([G2](../../guardrails.md)), unchanged by this page.

<!-- OWNER: D-1, approved 2026-10-31. Rejected: hand-rolled JSON-RPC framing — about 200 lines owned for ever, drifting on cancellation, progress and workspace/configuration, while the browser client is an official dependency anyway. -->

**Call tips (implementation note, #2079).** While an author types arguments, the language server provides the registered command's signature and help from the same catalogue as hover. It identifies the active argument without counting commas inside nested expressions, strings or comments; incomplete buffers need not compile. A member call, unknown name or cursor inside a comment gets no guessed built-in signature. The feature is available through both stdio and web transports.

<a id="tool-1-project"></a>
**The running project (implementation note, #2089, #2081, #2074, #2091; owner ruling 2026-11-12).** The language server learns everything it knows about a project from one main file, the way a build tool learns a project from its project file. Without that file a document is analysed on its own, and the server says so rather than claiming a clean result.

- **Selection.** The running project is one `.gam` file, which the author selects explicitly. The host records the selection in the workspace and shows it. In the VS Code extension the record is the workspace setting `rpgcode.project`, written by the command **RPGCode: Select Running Project** and shown in the status bar. The host never chooses a file itself: if no file is selected, the workspace has no running project, even when it holds one `.gam`, several of them or none. The project is never inferred from the workspace root, the open file or the editor language mode.
- **Root.** If the `.gam` file is in a folder named `Main` (ASCII case-insensitive), the project root is that folder's parent. Otherwise the root is the folder that holds the `.gam`. This covers the Toolkit folder (`Main/<name>.gam` beside `Game/`), a loose folder, and a package with a root-level `main.gam` ([project layout](../formats/packaging-and-paths.md)). If the inventory holds files under `Game/<projectPath>/`, references resolve there, as in the Toolkit folder. Otherwise the root is a package root and the stored `projectPath` is ignored, as for a loose folder.
- **What the project supplies.** The server reads the main file with the same reader the engine boots with, then selects the dialect with the [boot rule](rpgcode-dialects.md#reawakened-project-script-dialect): main-file version 2.0–2.2 is Toolkit 2.x and every later version is 3.1. The project also supplies its inventory: every `.prg` and `.rnc` file under the root, with its root-relative path, its original document URI and its bytes. `#include` and `file.func` resolve through that inventory with the engine's resolver. A reference that resolves to a folded key goes back to that file's original URI, never to the key. The resolver's first-wins rule picks the file when two paths fold to the same key. The project's lint configuration is `tkr-lint.json` at the root ([TOOL-3](#tool-3)).
- **Transport.** The client sends the project to the server as the `rpgcode/project` notification, which carries one complete snapshot:

  | Field | Contents |
  |---|---|
  | `revision` | a number that increases with every snapshot the client sends |
  | `main` | `{ uri, bytes }` (bytes in base64), or `null` when no project is selected |
  | `rootUri` | the project root, as defined under **Root** |
  | `files` | `{ path, uri, bytes }` per inventory file, where `path` is relative to the root with `/` separators and keeps its original spelling |
  | `lintConfig` | `{ uri, text }` for `tkr-lint.json`, or `null` when the file is absent |
  | `problem` | optional: why the client could not read the complete project |

  The server replaces its whole project with the snapshot that has the highest revision, ignores an older one and republishes every open document. A client sends a new snapshot when the selection changes and when a `.gam`, a program or the lint configuration under the root is created, changed or deleted. The VS Code extension builds the snapshot through `workspace.fs`, so the desktop (stdio) and web (worker) hosts get the same project, including in virtual workspaces. Any other LSP client may send the same notification. A buffer open in the editor supersedes the snapshot's bytes for the same URI.
- **Scope.** A document belongs to the running project when its URI is exactly the URI of an inventory file. For such a document the dialect, include resolution and lint configuration are **assessed**.
- **Unassessed.** A document is **unassessed** when it is outside the project, when no project is selected, or when the main file is missing, unreadable or not a main file. A snapshot that reports a `problem` also leaves every document unassessed. The server then publishes one Information diagnostic with the code `project.unassessed` at the start of the document, giving the reason. It never treats an unassessed document as clean:

  | Feature | Assessed | Unassessed |
  |---|---|---|
  | Parse diagnostics | in the project dialect, authoritative | provisional, in the language mode's reading (`rpgcode` as 3.1, `rpgcode-tk2` as Toolkit 2.x), next to the `project.unassessed` diagnostic |
  | Hover, completion, outline | project dialect; includes resolved | language mode's reading; includes unresolved |
  | Go to definition | in the document, and across explicit and implicit includes, to the original URI | in the document only |
  | Lint findings | published with the project's configuration, for the document's own range only | not published |
  | Formatting | 3.1: [TOOL-4](#tool-4); Toolkit 2.x: refused | refused |

  A refused format returns no edit and tells the author why with a `window/showMessage` warning. It never rewrites the text.

<!-- OWNER: approved by Jensen 2026-11-12 on #2089, #2081, #2074 and #2091: "The selected .gam is the project file (like a csproj): it is selected and marked as the running project in the workspace, and project scope and all other project knowledge flow from it." Rejected: a guessed workspace root, the editor language mode as the dialect, and a separately maintained inventory — each can disagree with the game the engine actually boots. -->

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

<a id="tool-3-range-convention"></a>
**TOOL-3 range convention.** A range is a `start` and an `end` position. A position is a `line` and a `column`, both **1-based**, and `end` is **inclusive**: it names the last code unit of the range, so an empty range has `end` equal to `start`. A column counts **UTF-16 code units of the decoded source**, never bytes or code points. That single choice is what lets a consumer slice the text exactly: for a range on one line, `source.split("\n")[line - 1].slice(start.column - 1, end.column)` is exactly the text the diagnostic is about.

Three consequences the tooling relies on:

- A Windows-1252 byte is one code unit, so it advances a column by one; a supplementary-plane character is a surrogate pair, so it advances a column by two. Byte offsets and code-point offsets both disagree with this, which is why neither is used.
- The CR of a CRLF pair is not counted: it precedes the line break, so the first code unit of the next line is column 1.
- A token never spans a line. A zero-width token — the `end` marker of a statement on a newline, or end of file — has `end.column === start.column`, which is a valid position, not an empty one to be special-cased. A composite syntax node anchors on the token its `line` came from, so its own range is one token's range.

The tokens the lexer emits carry exactly this range (`col` and `endCol` on `Token`, `packages/core/src/script/lex.ts`), and `packages/core/test/script-lex-spans.test.ts` proves it on tabs, CRLF, a Windows-1252 byte, an astral character and slicing.

<!-- OWNER: D-3, approved 2026-10-31 (the range convention fixed in 10.3 after the lexer showed "decoded characters" was ambiguous). Rejected: byte offsets — they would disagree with the editor's and the LSP's positions at every non-ASCII character; and code-point offsets — they would split a surrogate pair and make slicing throw one code unit short. -->

<a id="tool-3-rules"></a>
**TOOL-3 rule table (owner-approved plan, #2073 and #2077, 2026-11-12).** *In plain terms:* the linter points at code that is probably a mistake or out of date — a local variable nothing reads, a label nothing jumps to, a function nothing calls, a statement that can never run, a command the catalogue marks deprecated or obsolete, and a line the formatter would write differently. When it cannot be sure, it says so instead of staying quiet: a rule it could not check is listed as **unassessed**, never counted as clean. *Precisely:* the rules below are added to the existing ones (`lint/unknown-command`, `lint/command-arity`, `lint/shadowed-builtin`, `lint/unresolved-include` and the four `dialect/*` rules), with the same configuration, severity override, ignore list and summary. None of them deletes or replaces executable code; only `style/format` offers an edit.

| Rule | Default | Reports | Never reports when |
|---|---|---|---|
| `lint/unused-variable` | warning | a `local(x)` declared in a function or method body (with its lambdas) whose name is never read there: not read, not passed, not called as a callable, not captured by a lambda, not the receiver or base of a member or element, and not written as a string literal | the scope calls `rpgcode` (`#RPGCode`) or `bindingOf`, which can reach a local by a computed name |
| `lint/unused-label` | warning | a label in a function, method or lambda body ([STX-5](rpgcode-language.md#keywords-and-structure)) that no `:label` reference, call or string literal in that scope names | the scope calls `rpgcode`, or passes `branch`, `setErrorHandler` or `on error goto` a target that is not a literal label |
| `lint/unused-function` | hint | a script function no call, variable read or string literal anywhere in a **closed project** names and the project does not declare as an entry point; the message says no static use was found, not that the engine can never run it | the project is not closed, a program failed to compile, an include is unresolved, or any program calls `rpgcode` |
| `lint/unreachable-code` | warning | the first statement after a `return`, or after a call that is demonstrably the built-in `end`/`done`/`stop`, in the same block, before the next label (a statement whose nested block holds a label is a branch target and is not reported) | the scope installs an error handler or calls `resumeNext` (`on error`, `setErrorHandler`), calls `rpgcode`, or the terminator name may be rebound (a local, parameter or assigned variable of that name, FUN-8 entry 1) |
| `lint/deprecated-command` | warning | a plain call that resolves to a catalogue entry tagged `deprecated`, quoting its `replacedBy` and `reason` | the call is a method call, a `file.func` call, or a name that may be rebound as above |
| `lint/obsolete-command` | warning | the same for an entry tagged `obsolete` | as above |
| `style/format` | hint | a line that the [TOOL-4](#tool-4) formatter would rewrite, with that line's formatter output as the one edit | the dialect is not known to be 3.1 |

A deprecation finding never offers a rename: the legacy audio commands, for example, have different defaults and waits from `mediaPlay`, so a mechanical replacement could change what a game does. A `style/format` edit replaces exactly one line with the formatter's own output for it; the formatter's guarantees (TOOL-4: re-indent and canonical casing only, behaviour-preserving) are what make it safe, and the linter infers no other convention.

**Arity of a call that is not the command (#2077).** `lint/command-arity` checks a call against a registered command only when the call can reach that command. A plain call of a name that is a parameter, a declared local or a captured local of the enclosing function or lambda, or a global name the program assigns a value that may be callable (not a number, string, arithmetic or dictionary literal), may run a callable bound to that name first ([FUN-8](rpgcode-language.md#keywords-and-structure) "Calling a name", entry 1), so it is not checked; a method call (`p->wav()`) whose name is a method of a class the program declares, or a host method, dispatches on its receiver and is not checked. Any other call is checked exactly as before, so `start()` with no argument still warns and `wav("a.wav")` stays clean.

<a id="tool-3-assessment"></a>
**TOOL-3 assessment: what the linter could not check.** The lint summary carries `unassessed`, a list of `{ file, rule, reason }` entries, one per program, rule and reason, beside `disabledRules` and `ignoredRanges`. An entry means that rule did not run, or did not run over all of that program, so the absence of its findings is not evidence of a clean program. The reasons are a closed set; adding a value is a minor change:

| Reason | Meaning |
|---|---|
| `missing-source` | the program's parsed units or source text were not supplied (an index read back from JSON carries no parsed units) |
| `unknown-dialect` | nobody stated whether the source is 3.1 or Toolkit 2.x; the compiler's or formatter's default is not evidence of the dialect |
| `unsupported-dialect` | the rule does not apply to the stated dialect (TOOL-4 refuses Toolkit 2.x), or the stated dialect differs from the one the program was compiled in |
| `unmapped-source-span` | a finding's original span cannot be verified: the program is Toolkit 2.x, whose normalisation moves source columns, or the formatter's output does not line up line for line with the source |
| `invalid-program` | the program did not compile, so it has no facts |
| `incomplete-project` | a project-wide rule ran without a closed project, or with an unresolved include |
| `dynamic-reference` | a scope evaluates code or names by computed text (`rpgcode`, `bindingOf`, a computed branch target), or installs an error handler that can resume after a failing statement (ERR-1), so a use or a path cannot be ruled out |

In an assessed document that compiles, the language server uses the running project's dialect and configuration for lint. When the lint summary has unassessed entries for the document, the server publishes one Information diagnostic at the start of the document with code `lint.unassessed`. Its message lists the rule IDs and reasons, and its diagnostic `data` carries those summary entries. Findings and this status can appear together. A document outside the project still uses the `project.unassessed` status from TOOL-1.

The rules that read the parsed program (`unused-variable`, `unused-label`, `unreachable-code`, `deprecated-command`, `obsolete-command`, `style/format`) need a stated dialect: they run when it is 3.1 and are unassessed otherwise. They report on each program's own main unit; an included file is checked when it is itself linted as a program, so a file shared by several programs is reported once. In a closed project, a function in an included file that no program of the index owns is unassessed (`incomplete-project`).

**Closed projects.** `lint/unused-function` is a project-wide claim, so it runs only when the caller states the project is **closed**: every program of the project is in the index, and the caller names its external entry points (the functions the engine or another package calls by name). Project knowledge comes from the selected project file (the `.gam`, owner ruling of 2026-11-12), never from a guessed workspace root, the editor's language mode or a list of paths given on a command line; a host that cannot derive closure from the project file leaves the rule unassessed. `tkr script check` does not yet derive closure, so it reports the rule as unassessed.

**The summary's shape (version note).** `unassessed` is a required field of the shared library's `LintSummary`, which is a source-breaking change for code that builds a summary itself. The package has not been published (the registry has no `@tk-reawakened/script-tools`, the repository has no release tag, and the release runbook #951 is open), so the change is made before the first 1.0.0 release rather than in a next major; a consumer that builds a `LintSummary` adds `unassessed: []`. `tkr script check --json` carries the same three fields under `results.lint` (an added field of `tkr-script-result/1`), and its human report names the unassessed rules after the totals, so a run with skipped analysis never reads as fully checked. `check` passes `--dialect tk3|tk2` to compilation and to the linter; without it the dialect-dependent rules are unassessed.

**Evidence and its limits.** Each rule has positive and negative tests in `packages/script-tools/test/lint-rules.test.ts`. A category-representative authored fixture of visual-event-builder-shaped programs (`packages/script-tools/test/fixtures/veb-categories.prg`) checks clean; it is **interim evidence only** — [T-45](../../editor-features.md) names about 160 templates but no enumerated list exists, so full inventory and live generated output stay open with #1744 and #1746.

<a id="tool-4"></a>
**TOOL-4 Formatting.** The formatter is a source-text rewrite with exactly two jobs: re-indent by brace depth, with a configurable indent width (default four spaces), and normalise built-in names, keywords and the reserved literals to their canonical lower-case spelling. It leaves string contents, map keys written as strings, comments and label spelling alone.

It is a **3.1 source formatter**. A Toolkit 2.x file is a different dialect, and in it a loose text line with no `#` is **dialogue data**, not code: rewriting it would change what a game says. The formatter therefore refuses a file it is told is TK2 — it returns the text byte-identical with the reason `tk2-dialect`, and `--check` counts that file as **skipped with its reason, never as clean**, so a bulk run cannot claim a file was formatted when it was not. Converting TK2 text is the dialect quick fixes' job (§T-42's neighbours), not the formatter's; a TK2 formatter is not planned.

It is **idempotent** — formatting formatted text is a no-op — and **behaviour-preserving** — a run before and after formatting gives the same lowering. (The state hash includes each program's source hash under [R-42](rpgcode-modules-and-objects.md#redirects), so a text-only edit normally moves that hash even when the instructions are identical; the spec's promise is the instructions.) It never reorders statements, drops a comment, joins a continued line, or adds a final newline that the file did not have. A file whose last line has no newline keeps it that way ([PRG-2](rpgcode-language.md#programs-and-encodings)).

<!-- OWNER: D-4, approved 2026-10-31. Rejected: an AST-printing formatter (parse, then print) — the parser discards whitespace and comments irrecoverably, so a printer would delete comments, the one thing the legacy indent and cleanup wizards never did. -->

**Toolkit 2.x migration actions (implementation note, #2045).** A legacy source can look valid in 3.1 but mean something different, so its dialect must be explicit before offering a dialect-dependent rewrite. The language server uses the document language id `rpgcode-tk2` for an author-selected Toolkit 2.x source; ordinary `rpgcode` documents keep their 3.1 meaning. The language mode does not change the project main file or the dialect selected by its runtime. A single-file conversion must therefore never overwrite the original TK2 source: in the VS Code extension it opens a new unsaved 3.1 buffer, visibly labelled as a preview for a separately migrated 3.1 project. It does not claim that the original project has been migrated. A preview compares the isolated caller's compiled representation across dialects and is withheld when either compile is inconclusive, an include is unresolved, or a known command loads another program dynamically. This is not proof of the behavior of a complete project or its external dependencies; a safe project-wide migration remains required. Preserve comments and line endings. What each legacy form converts to, which forms are flagged for review, and which are refused is set out in the [conversion contract](rpgcode-dialects.md#tk2-conversion-contract).

An in-place edit in the ordinary `rpgcode` mode must preserve the source under both 3.1 and Toolkit 2.x readings unless the host has established the actual project dialect independently of the editor language id. If either comparison is inconclusive, do not offer the edit (#2070).

<a id="tool-5"></a>
**TOOL-5 The spec API.** RPGCode programs can be tested in RPGCode. The API is a package, not a set of engine built-ins: `script-spec` ships a library program and a **closed, test-only set of twelve native commands** ([below](#tool-5-natives)): `specResult`, which records a result and the source position the VM already knows, seven matcher helpers that read what a library program cannot, and four [test doubles](#tool-5-doubles) a case calls directly. The package defines the names below; a program that wants them includes or loads the package, and a shipped game never does.

| Name | Shape | Meaning |
|---|---|---|
| `describe(name, body)` | nestable | a group of cases |
| `it(name, body)` / `test(name, body)` | `body` is a callable called with no arguments | one case |
| `beforeEach` / `afterEach` / `beforeAll` / `afterAll` | `body` callable | hooks around the cases in the enclosing `describe` |
| `expect(actual)` | returns a matcher object | assertions listed below |
| `expect(actual).not` | the negation of every matcher | |
| `toBe`, `toEqual`, `toBeTruthy`, `toBeNull`, `toContain`, `toBeCloseTo(expected, tolerance)`, `toThrow()` | chained on the matcher object | see below |
| `toHaveBeenCalledWith(args)`, `toHaveBeenNthCalledWith(n, args)` | chained on the matcher object over a spy | see [test doubles and spies](#tool-5-doubles) |
| `specInput`, `specTicks`, `specRng`, `spyOn` | called by a case | see [test doubles and spies](#tool-5-doubles) |
| `skip` / `only` | prefix a case or a `describe` | run control |

`toBe` compares strictly: the same runtime type and value with no number/string conversion (`5` is not `"5"`), a class instance by handle and an array by identity. `toEqual` compares by value: numbers, strings, dictionaries key by key, and arrays element by element to any depth, again without number/string conversion. `toBeTruthy` applies the engine's own truth test ([R-39](rpgcode-language.md#compatibility-notes)), `toBeNull` passes for the unset value, and `toContain` searches a string (case-sensitive substring) or an array (an element equal under `toEqual`). `toBeCloseTo(expected, tolerance)` passes when the subject, `expected` and `tolerance` are finite numbers, `tolerance` is 0 or more and the difference is at most `tolerance`. `toThrow()` takes no argument: the subject of `expect` is a callable, and the matcher passes when calling it raises an unhandled runtime error ([ERR-2](rpgcode-errors-and-threads.md#err-2)), which is then consumed and does not fail the case. A failure message shows expected against actual and the source line of the failing assertion.

**Arrays.** "Array" above means either shape the language has: a legacy element array, whose entries `name[index]` are separate variables ([SEM-5](rpgcode-runtime.md#sem-5--unset-variables-and-array-elements)), or a **list**, a dictionary holding `length` and the keys `"0"` to `"<length - 1>"` ([JSON text and dictionaries](rpgcode-json.md)). A list is a dictionary, so `toEqual` compares it key by key, `length` included; `toContain` on a list searches its entries `"0"` to `"<length - 1>"` and never `length` itself.

**Arities.** Every matcher is a lambda with one fixed declared arity ([FUN-1](rpgcode-language.md#keywords-and-structure), [ERR-2](rpgcode-errors-and-threads.md#err-2)) and methods stay call-only ([OOP-11](rpgcode-modules-and-objects.md#oop-11); owner ruling F-F, 2026-11-01). So `tolerance` is **required**, unlike Jasmine and Jest, and `toBeCloseTo(1.0)` is the located failure `callable.arity`. `tolerance` is compared as stored; the code under test is still subject to [SEM-3](rpgcode-runtime.md#sem-3--comparison-and-conversion)'s name-read truncation, so `x = 1.5; expect(x + 0.25).toBeCloseTo(1.25, 0.001)` passes.

The runner discovers `*.spec.prg`, runs each case on a fresh fixture (board, party and variables) under the injected clock and the seeded RNG, so two runs of the same spec file give identical results and identical state hashes. A skipped case fails the strict run; `only` narrows the run to the marked cases and warns that it did. A discovered `*.spec.prg` that registers no case is the failing outcome `spec.no-cases` at its line 1, so a spec whose `#include` of the package was not found cannot pass silently. The package is loadable only by the test runner: it must not appear in the engine's default manifest, and a test asserts that it does not.

When the test root is an RPGCode package with a `manifest.json`, its declared root-level program is available to `executeProgram` under `Prg/` for its own specs. A spec can thereby exercise the actual package startup without copying it. In each test tick the runner advances scripts and the core events phase in the engine's order, so queued events and their listeners use the real dispatcher rather than a test substitute. The tick budget and strict skip rule above still apply.
The runner's default fixture exposes its selected party actor as the `specActor` global, an ordinary core-owned actor emitter; `specActorId` is its numeric actor ID. These test-only names let a case observe actor-scoped events without replacing the engine's actor or event implementation.
When a package has a corresponding first-party native plugin, its test run registers that plugin's real commands alongside the engine and test commands; it does not substitute a fake implementation.
The linter recognizes the TOOL-5 registration and matcher names in `*.spec.prg` files, where the runner supplies the package; this does not make those names available in ordinary game programs. Other unknown calls in either kind of file remain diagnostics.

**Reports, selection and watch.** Each case result retains its ordered enclosing group names, case name, outcomes and state hash. Selection uses a case-sensitive literal substring of the full name formed by joining the group names and case name with ` > `. An empty filter selects all; a filter matching no case succeeds with zero cases, but discovery errors and files registering no cases still fail. Project-wide `only` selection applies before the name filter. Only selected cases and their necessary group hooks execute.

The test command accepts `--name <substring>`, `--reporter spec|junit|json` and `--watch`. The default `spec` report lists file, nested group and case results and failures. `junit` writes deterministic UTF-8 XML with one suite per file, case names and group paths, escaped text, failure or skipped elements, and focused-run warnings in the suite's `system-out`. JSON uses the existing `--json` envelope with case group paths added to its test payload; `--json` and `--reporter json` are equivalent. Other combinations of `--json` and a reporter are usage errors. Reports preserve discovery order and contain no timestamps or durations.

Watch mode performs an initial full run and repeats a full project run after relevant project file changes, including additions and deletions. It serializes runs and queues a further run if changes arrive during a run; failures from unchanged files therefore remain visible. Each run emits a complete report and updates the process exit status to that run's result; stopping with SIGINT exits with the latest result. JUnit watch requires `--out <file>` and replaces that file with one complete XML report per run, without treating its own output as a project edit; non-watch JUnit may also use `--out`. Watch mode is host-side and never enters the deterministic engine.

<a id="tool-5-group-hooks"></a>
**Group hooks and the fresh fixture.** A `describe`'s `beforeAll` runs **once**: the runner runs it after the group's own registration, takes a snapshot of the simulation, and starts each case of that group from the snapshot, so "a fresh fixture" for a case inside a group means **that group's post-setup snapshot**. Groups nest: an inner group's `beforeAll` runs from its outer group's snapshot, and a case starts from the snapshot of the innermost group that has one. `beforeEach` and `afterEach` run around every case, outermost first and innermost first respectively. `afterAll` runs once, from the group's snapshot, after the group's last case. When a `beforeAll` raises an error, every case of its group fails with that error and its `afterAll` still runs. Snapshots are the VM's own ([AD-1](../../../_bmad-output/initiative-rpgtoolkit-reawakened/architecture-rpgtoolkit-reawakened/architecture-rpgtoolkit-reawakened.md), 3.11), so the run stays deterministic and resumable.

<a id="tool-5-natives"></a>
**The native commands.** They are registered under their [LEX-10](rpgcode-language.md#lexical-rules) folded names only while `script-spec` is loaded and are listed with their full rules in [rpgcode-functions.md](rpgcode-functions.md#tooling-the-rpgcode-spec-package-not-part-of-the-282-legacy-catalogue). Authors call the matchers, never these.

| Command | Why a library program cannot do it |
|---|---|
| `specResult` | records the outcome with the call's source position |
| `specCapture(&value)` | `expect`'s argument must be read by reference while its frame is live: a closure copies the value and drops the reference, and an element array is many variables, not one value |
| `specEqual`, `specContain` | the language has no type test and no way to list an element array's indices or a dictionary's keys |
| `specClose` | compares stored doubles without passing them through a named-variable read, which would truncate them (SEM-3) |
| `specThrowBegin`, `specThrowEnd` | an error in a called function never reaches the caller's handler ([ERR-1](rpgcode-errors-and-threads.md#err-1--the-handler-its-label-and-resumenext)), so only the VM can observe it |
| `specCalled` | compares the argument pictures a spy recorded on the host, which no script can read |
| `specInput`, `specTicks`, `specRng`, `spyOn` | schedule a host input, park the caller for whole ticks, replace the RNG port's draws and wrap a command's handler: each acts on the runner's side of the VM, which a program cannot reach ([test doubles and spies](#tool-5-doubles)) |

`specCapture` returns an **opaque snapshot string** passed only between `expect` and the matcher helpers. No script may read it, it is never saved as a stable format and no stability promise covers it. Its reference identities (for `toBe` on arrays and instances) come from a counter that is reset for each case and advances once per capture in program order, never from a host address, so two runs of the same case produce the same strings.

The commands this page adds to the catalogue are listed in [rpgcode-functions.md](rpgcode-functions.md#tooling-the-rpgcode-spec-package-not-part-of-the-282-legacy-catalogue) (the twelve native commands and the package's public names).

<a id="tool-5-doubles"></a>
**Test doubles and spies.** In plain terms: a case can press and release keys at chosen moments, let a number of game ticks pass, decide in advance which random numbers the game gets, and watch a built-in command to check later what it was called with. The real engine still does the work: a scheduled key goes through the ordinary input rules, `random` still turns the supplied number into its own range, and a watched command still runs. Technically, four natives schedule or replace an input the runner owns, and two matchers read what a spy recorded:

| Name | Shape | Rule |
|---|---|---|
| `specInput(tick, name, code, char, down)` | void | Schedules one key edge for the absolute fixture tick `tick`. `tick` is a whole number **greater than** the tick the call runs in; `name` and `code` are non-empty strings, the same fields as the engine's key event ([E-110](display-input-audio.md#e-110)); `char` is a one-character string, or `""` or the unset value for no character; `down` is 1 for a press and 0 for a release. At the start of that tick, **before its wait poll**, every edge scheduled for it enters the ordinary input section as a host key event would, once, in scheduling order. Any other argument is the error `spec.bad-input`. An edge still scheduled when the run ends fails the run with `spec.input-pending`, naming its tick: an edge is never dropped silently. |
| `specTicks(count)` | int | `count` is a whole number from 0 to 1,000. With 0 it returns the current fixture tick at once, so `specTicks(0)` reads the tick; otherwise its value is the unset value and only the calling thread waits, as a cooperative sleep ([THR-1](rpgcode-errors-and-threads.md#thr-1--the-sleep-its-unit-and-wake-order)), and resumes in the wait poll of tick *T* + `count`, where *T* is the tick of the call. Other threads, events and engine phases keep running. A negative, fractional, non-numeric or non-finite count, or one over 1,000, is the error `spec.bad-ticks`. The run's 1,000-tick ceiling still applies (`spec.timeout`). |
| `specRng(draws)` | void | Supplies the RNG draws of the commands the case calls. `draws` is a list (a dictionary holding `length` ≥ 1 and the keys `"0"` to `"<length - 1>"`, [Arrays](#tool-5)) of whole numbers from 0 to 4,294,967,295; anything else is the error `spec.bad-rng`. From then on, each draw a command takes through the injected RNG port takes the next supplied number in order instead of advancing the seeded generator, and the command applies its usual rules to it: `random(6)` given the draw 7 returns `1 + 7 mod 6` = 2. A draw after the last supplied number is the error `spec.rng-exhausted` at the call that drew it; it never falls back to the seeded generator. A later `specRng` replaces whatever is left. Scripted draws do not advance the saved generator state. A draw taken outside a command call (an engine phase) is not scripted. |
| `spyOn(name)` | string | Installs a **forwarding spy** on the command a plain call of `name` reaches (its top layer, [plugin layers](rpgcode-language.md#plugin-commands)) and returns an opaque handle for `expect`. `name` is folded like any call name (LEX-10), and an alias reaches the same command, so a spy sees calls made under every name of its target. From the moment it is installed, each call that reaches the target records the picture of every argument as `specCapture` takes it, at call time and before the command runs, then forwards to the real command unchanged: its return value, by-reference writes, waits, effects and errors are those of the unwatched call. Calls before installation are not recorded. A name that reaches no command, a `script-spec` command or a catalogue placeholder that has no implementation is the error `spec.spy-target`; spying on a target that already has a spy in the same run is the error `spec.spy-exists`. |
| `toHaveBeenCalledWith(args)` | matcher | Passes when the spy recorded at least one call whose arguments are, in order and with the same count, equal to the entries of the list `args` under `toEqual` (no number/string conversion). |
| `toHaveBeenNthCalledWith(n, args)` | matcher | Passes when the spy recorded an `n`-th call (counted from 1, in call order) whose arguments equal the entries of `args` as above. |

`.not` reverses both matchers: `.not.toHaveBeenCalledWith(args)` passes when no recorded call matches, and `.not.toHaveBeenNthCalledWith(n, args)` passes when there is no `n`-th call or it does not match. A subject that is not a spy handle installed in the same run, an `args` that is not a list, or an `n` that is not a whole number of 1 or more fails **in both polarities**. Every failure shows the expected call against the recorded calls (or "no calls") at the line of the assertion. Each matcher is a lambda with one fixed arity, as [Arities](#tool-5) requires: `toHaveBeenCalledWith` takes one argument and `toHaveBeenNthCalledWith` two.

The errors above are catchable runtime errors ([ERR-2](rpgcode-errors-and-threads.md#err-2)) located at the call; uncaught, they fail the case like any runtime error, and `toThrow` can observe them.

**Isolation and replay.** Scheduled edges, scripted draws, spies and their call records are host-side state of **one run**: a case run, a `beforeAll` run and an `afterAll` run each start with none, even when they resume from a group's snapshot, and nothing installed in a `beforeAll` carries into its cases. They are never saved, never part of a snapshot and never hashed; only what they cause in the simulation (an input edge, a command's effects) is. The determinism check re-creates them from the script on the second run, so the two runs still give identical results and state hashes. The package's helpers are absent from the default manifest; without these calls a run is unchanged.

<!-- OWNER: #2042 approved by Jensen, 2026-11-12 (plan `_bmad-output/initiative-rpgtoolkit-reawakened/epic-rpgcode-tooling/plan-2042-test-doubles.md`): scheduled key-down and key-up edges, fixed-tick waits, scripted RNG draws, forwarding spies, and argument and order matchers including `toHaveBeenCalledWith`. Rejected: a TypeScript-only spy API (RPGCode authors could not use it); forcing `random`'s return value (bypasses its real range rules); replacing engine commands globally (contaminates production); falling back to the seeded generator after the scripted draws run out (hides a missing interception); re-running `beforeAll` per case so its doubles reach the cases (breaks TOOL-5's once-per-group rule). `specTicks(0)` returning the current tick is this page's addition, because no other command reads the tick. -->

<a id="tool-5-coverage"></a>
**Line coverage.** In plain terms: after a test run, you can ask which lines of your RPGCode ran and how many times, including the lines that never ran, so you can see what your tests miss. The answer comes back as data and as an LCOV text that coverage viewers read. Technically, coverage is collected only when a caller of the `script-spec` API asks for it. It observes the real VM's instructions as they run and changes nothing the run does, saves or hashes.

1. **Which files.** Coverage lists every file of every program a counted run executes at least one instruction of: the spec file itself, the programs it `#include`s, and programs a case loads at run time (`executeProgram` and the like). A file is listed under its project path: the spec file under its spec path, and a project program under the path the project loader served it from. Include spellings that differ only in case are one file, because the asset resolver folds them; two files with the same base name in different folders stay two files. A project program that no counted run loads is not listed. The bundled `script-spec` library and the lines the runner appends after the spec's own text are never listed.
2. **Which lines.** A line is **executable** when the compiler placed at least one instruction on it: a statement, a part of an expression that continues onto it, or a control-flow condition or loop header. Blank lines, comments, lone braces, `else` and function headers carry no instruction and are not listed. The `return` the compiler adds at the end of a body or a file is not a statement and makes no line executable; a `return` the author wrote is. Every executable line of a listed file is listed, including the lines of functions nobody called, with a count of 0.
3. **What one run counts.** Within one counted run, a line's count is the **largest** number of times any one of its instructions ran. Two statements on one line that each ran once count 1, not 2. A `while` line whose test ran four times and whose body ran three times counts 4, and each body line counts 3. A `for` line counts the number of times its condition ran. A recursive call counts every execution.
4. **Which runs count.** One case run, one `beforeAll` run per group and one `afterAll` run per group, as TOOL-5 already runs them. A case resumed from a group's snapshot counts only what it runs after the snapshot. Discovery (collecting the registered cases) and the second run of the determinism check are not counted; the second run must produce identical coverage or the file fails as it would for a differing hash. Unselected and blocked cases run nothing and so count nothing. A skipped case's run starts from a fresh fixture and executes the file's registration (so registration lines count once more) and its skip report, never the case's body.
5. **Adding up.** A file's count for a line is the sum of its per-run counts. A project report sums the file reports, line by line. For example, if two instructions on one line run `(2, 0)` times in one case and `(0, 3)` in another, the line counts 2 + 3 = 5.
6. **Output.** `runSpecFile` and `runSpecProject` take `coverage: true` and then return `coverage`: files in code-unit order of their paths, each with its executable lines in ascending order and their counts. Without the option the report has no `coverage` field and the run takes no observer, so the test command's JSON is unchanged. `toLcov(coverage)` returns LCOV text: for each file `SF:<path>`, one `DA:<line>,<count>` per executable line, `LF:<executable lines>`, `LH:<lines with a count above 0>` and `end_of_record`, each line ending in `\n`. Coverage with no files is the empty text. The same source, seed and selection always give the same coverage and the same text. There is no command-line flag; only the API exposes coverage.
7. **Guard-rails.** The counts are kept by the host beside the run and are never part of the simulation (G1, G3). TypeScript coverage of the engine is a separate measurement and is never mixed in.

<!-- OWNER: #2041 approved by Jensen, 2026-11-12 (plan `_bmad-output/initiative-rpgtoolkit-reawakened/epic-rpgcode-tooling/plan-gh-2041-rpgcode-line-coverage.md`): count executable lines in every program the run encounters, including uncalled functions and includes; exclude project programs that are never loaded, and test-harness lines; produce deterministic LCOV through the API only, with no CLI flag. The line-count rule (largest instruction count per run, then summed) is the plan's recommendation. Rejected: every project program even if never loaded (needs a project-wide compile and error policy); summing every instruction or statement on a line (inflates shared lines); the largest count after summing all runs (loses hits from separate cases); hit/miss only (loses repeat counts); a `--coverage` CLI flag (the reporter work in #2043 owns the CLI output). -->

<!-- OWNER: F-A, F-D, F-E and F-G approved by Jensen, 2026-11-11 (#948). Rejected for F-A: `typeOf`/`arrayCount` as general built-ins — they would put test-only commands in every shipped game's catalogue (ADR 0014) and still could not list a sparse element array; relaxing ERR-1 so a nested error reaches the caller — it is verified 3.1 behaviour (R2-Q10) and would change game control flow across the corpus; class-method tear-offs for an optional tolerance — ruled out by F-F. Rejected for F-E: re-running `beforeAll` per case (what the first runner did) — a once-per-group hook that runs per case is not a once-per-group hook; dropping `beforeAll`/`afterAll` — contradicts the epic's Done-when 8. F-G: the missing-include gap itself stays a MOD question; `spec.no-cases` closes the silent pass the tooling can see. -->

<!-- OWNER: D-5, approved 2026-10-31. Rejected: about twenty native built-ins — each would need a spec row and a catalogue entry, `it` could not call its lambda without a new VM capability, and every shipped game's catalogue would carry test commands. -->

<a id="tool-5-creator-tests"></a>
**Reawakened rule (accepted by the owner, 2026-11-09; entry 11.1, [ADR 0022](../../adr/0022-shared-editor-authoring-contracts.md) D9; creator tests).** In plain terms: a creator can write a short test in an ordinary `*.spec.prg` file that sets up a tiny scene, makes the player walk or interact, waits a bounded time for something to happen, and checks the result. It runs the real game engine, not a pretend one, and the result points at the failing line. Technically, this extends TOOL-5; it adds no second runner, no new file type and no wall-clock waiting.

1. **One framework.** Creator tests are TOOL-5 specs. `describe`, `it`, hooks and matchers keep their meaning above. The additions below are provided by the same `script-spec` package and, like it, never appear in a game's default manifest.
2. **Fixture.** A case starts from a fresh simulation: board, party, variables, seeded RNG and provider state all reset, so a case cannot see another's changes. A fixture names **one authored board** from the project (a small purpose-built board, not the whole game) and the player's starting position and facing, and may set stats, inventory and variables. Collision, triggers and programs on that board run as the engine runs them; **nothing is substituted by a mock**. A fixture never loads files the case did not name.
3. **Actions.** An action list is an ordered list of player **actions** — the engine vocabulary of [ADR 0017](../../adr/0017-input-actions-devices-and-accessibility.md), `up`, `down`, `left`, `right`, `confirm`, `cancel`, `menu` and any `game.*` action the project registers, never a physical key or button: a movement action held for a stated number of ticks, an interact (`confirm`) press, a menu or item choice. Each action is applied to the simulation at a tick, in order; a later action starts only after the previous one's ticks have elapsed. Naming actions rather than keys is what lets a test survive a changed `.gam` binding or a player's remap. The driver keeps advancing the simulation while a program waits (G1: programs stay step machines; the driver never blocks on them).
4. **Waiting.** A wait names a condition over observable state (a variable, a position, a board, an inventory entry) and a **maximum number of ticks**. It passes when the condition holds at a tick no later than the maximum and fails with `spec.timeout` otherwise, naming the condition, the tick budget and the last observed value. There is no real-time sleep and no unbounded wait; the existing 1,000-tick safety limit remains the ceiling.
5. **Assertions.** Assertions read state and events the engine already exposes (variables, actor position, current board, inventory, emitted effects such as `specresult`). A new projection is added only by editing this page first.
6. **Reports.** A failure shows expected against actual, the source line, the **last completed action**, the tick it completed on and the fixture's board file, plus a link to the owning program. Results carry the run snapshot of [ADR 0022 D8](../../adr/0022-shared-editor-authoring-contracts.md#d8--launches-and-run-snapshots) so a result names the revisions it ran against.
7. **Determinism.** The same fixture, actions and seed give the same tick-by-tick state and the same state hash on every runner, headless or visible.
8. **Exclusion.** Spec files, fixtures and the `script-spec` helpers are **not** shipped. Packaging excludes them, and acceptance inspects the produced package for them; a check that only reads the default manifest is not sufficient. The exclusion is written into the package rules (`docs/spec/formats/packaging-and-paths.md`, whose "Not included" row today names only `Saved\` and other projects' mains) and proved by the packaging workflow in **12.9**, together with the editor's reserved history folder ([ADR 0022](../../adr/0022-shared-editor-authoring-contracts.md) D12.7).
9. **Spellings.** The RPGCode names and argument shapes of the fixture, action and wait operations are **not fixed on this page yet**. Entry 11.9 proposes them in the function catalogue, with a help line for each in the plain-then-technical form this project uses, and the owner approves them in a docs-only commit before any implementation. Entry 14.1 separately rules how a visual fixture editor represents the same definition.

**Evidence.** TOOL-5 above (discovery, fresh fixture, injected clock, seeded RNG); `docs/spec/formats/rpgcode-program.md#test-runs-from-the-editor` (the 3.1 editor's test run); the owner direction in `_bmad-output/initiative-rpgtoolkit-reawakened/ux-connected-editors/connected-authoring-and-tests.md`; the 2026-11-08 audit of `packages/script-spec`, which found a hard-coded 1×1 synthetic board, no input driver, a fixed 1,000-tick limit and a `node:fs` dependency (`packages/script-spec/src/runner.ts:125-179`, `src/project.ts:1-5`).

**F-A, now ruled.** The 10.8 matcher ruling widened "one native command" to the closed, test-only set of [the native commands](#tool-5-natives) (owner, 2026-11-11). The fixture, action and wait operations of this rule, when 11.9 spells them, join that set by editing this page first; the set is closed in that it grows only by a docs change.

**Rejected alternative.** A separate editor-only test runner or a Playwright-style browser driver for game behaviour: it would duplicate the engine's rules and could pass where the real game fails. Playwright remains fine for testing the editor itself.

<a id="tool-6"></a>
**TOOL-6 Machine-readable index.** `tkr script index` writes one JSON document describing the programs it was given:

| Field | Contents |
|---|---|
| `schema` | `tkr-index/<major>.<minor>` |
| `programs` | per program: its reference, its functions (name as written, folded name, arity, line), classes with bases, members and methods, labels, the include edges it resolved (explicit and implicit, in order), the files it reached, its call and reference sites (name, arity, position), its literal event-listener names and its package start-up entry points |
| `diagnostics` | the [TOOL-3](#tool-3) diagnostics, so a program that did not compile is reported and given no invented facts |

**Stability promise.** Adding an optional field, or adding a value to an enumerated field, is a minor change; removing a field, retyping it, renaming it, or changing the meaning of an existing field is a major change. A consumer may rely on every field above; it may not rely on the order of members inside an object, on whitespace, or on fields not listed here.

<a id="tool-6-identity"></a>
**TOOL-6 symbol identity and the document's fields.** Every symbol has one stable id, `<file>#<kind>:<name>`, where `<file>` is the unit's canonical key (an inline program uses `<inline>`), `<kind>` is `function`, `method`, `member`, `class` or `label`, and `<name>` is the **folded** spelling. RPGCode folds identifiers ([LEX-10](rpgcode-language.md#lexical-rules)), so `MWin`, `mwin` and `MWIN` are one symbol; the folded spelling is its identity and the only spelling the compiler's tables hold. A class member or method qualifies with its owner: `prg/startup.prg#method:counter.bump`. Each definition also carries `qualifiedName`, the dotted name a reader recognises (`counter.bump`), which is not an identity because two files can define the same dotted name.

A **site** — a call, a member access, a variable read or write, a declaration — is `{ kind, name, written, scope, pos }`. `written` is the exact source spelling, present whenever the compiler's position is the identifier token: the site's range slices the text, so `written` is that slice. It is absent when the position is a keyword, because [TOOL-3](#tool-3-range-convention) anchors a function on `function` and a label on `:`.

Per program the document carries:

| Field | Contents |
|---|---|
| `name`, `key`, `files` | the caller's name for the program, its main unit's canonical key, and every unit key in load order (main first) |
| `functions` | `{ id, qualifiedName, name, arity, file, line, col, endCol, className }` per definition, from the compiler's own function table and the parsed unit |
| `classes` | `{ id, qualifiedName, name, file, line, col, endCol, bases, members, methods }`, members with `access` and `arraySize`, methods with `arity`, `access` and `isPure` |
| `labels` | `{ id, name, file, line, col, endCol }` |
| `includes` | one entry per `IncludeRequest` in source order: `{ path, implicit, key, file, line, col, endCol }`, where `key` is the resolved canonical key or absent when nothing served it |
| `calls` | `{ name, written, arity, file, fileParam, pos }` per `call`, `methodCall` and `construct` |
| `references` | `{ kind, name, written, scope, pos }` per `load`, `declRef`, `member`, `get_member_bound` and `storeRef`; a `storeRef` carries no name because the IR keeps the target on the stack, and its `kind` says so |
| `listeners` | `{ event, call, pos }` for every literal first argument of `on`, `once` and `emit` |
| `startup` | the package names whose start-up program this program is |
| `diagnostics` | the [TOOL-3](#tool-3) diagnostics of that program |

**Broken programs.** A program that does not compile contributes its diagnostic and an otherwise empty entry — no functions, classes, labels, includes, calls, references, listeners or start-up points are invented from a partial parse. The absence is the fact, and a consumer must not read "not listed" as "does not exist".

The index is **read from the compiler, not a second walk**: definitions come from `Program.functions`/`classes`/`labels` and the parsed units, sites from the lowered ops at their `SourcePos`, and the include requests from the units the compiler parsed. The schema is [schemas/tkr-script-index.schema.json](../schemas/tkr-script-index.schema.json); the same inputs produce the same bytes, so a diff means the source changed.

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
| `threads` | per thread: `id`, `kind`, `status` (`ready`, `waiting` or `finished`), the wait it is parked on (its `kind`, whether it is `global` and, for a `sleep` wait, the whole ticks it still has to run) and its frames |
| `frames` | outermost to innermost: the frame `index`, the program identity (`key`, plus the decoded `text` so a client can show an inline snippet it has no file for), the instruction pointer `ip`, the source `line` the frame is at, the `function` name (`null` for top-level code) and that frame's own `locals` |
| `locals` | the same list as the innermost frame of `threads`, so a reader that wants only the current scope needs one field |
| `globals` | the global table as name/value pairs, array elements (`name[index]`) included |

A value in the view is a number, a string, `null` for the unset value, `{ kind: "object", handle, className }` for a live object (a dictionary included) or `{ kind: "callable", def }` for a callable; it is never a reference into live storage.

The view is **copied out, never aliased to the live frames or tables**: mutating anything it returns cannot change the VM, and a call leaves the state hash unchanged. It is the only seam a debug adapter reads. Step over, step in and step out are computed by the adapter from the frame depth it sees between one-instruction resumes ([THR-3](rpgcode-errors-and-threads.md#thr-3)), so the engine gains no new stepping mode beyond the breakpoint contract in [AD-1](../../../_bmad-output/initiative-rpgtoolkit-reawakened/architecture-rpgtoolkit-reawakened/architecture-rpgtoolkit-reawakened.md).

<!-- OWNER: D-8, approved 2026-10-31. Rejected: exposing the whole game state from the engine — it would let a debugger read and, through a shared reference, mutate the versioned state, and it couples the debugger to every section's shape rather than to one projection. -->

<a id="tool-8-locals"></a>
**TOOL-8 locals travel with the frame (P2).** *In plain terms:* a debugger shows the call stack, and clicking a frame shows what the variables of **that** call were, not only the variables of the call that is currently running. *Precisely:* every entry of `frames` carries its own `locals` list, read through each slot's reference, so a local that aliases another variable, a captured closure cell or an object field shows the value the script itself would read; the top-level `locals` of the view is the innermost frame's list and is the same data, not a second query. A frame with no locals has an empty list.

<!-- OWNER: P2, approved by Jensen 2026-11-11 (#950). Decided: locals are a field of each frame. Rejected: restricting scopes to the innermost frame's locals plus the globals — a stack-trace frame could then not be inspected, which is the main use of a call stack; and a second projection (`debugLocals(thread, frame)`) — two reads of one thing drift, and a debugger would have to fetch twice for one screen. -->

<a id="tool-8-evaluate"></a>
**TOOL-8 expression evaluation (P1).** The engine exposes one expression reader for debuggers, `evaluate(expression, threadId, frameDepth?)`, returning `{ value, error }` with exactly one of the two set.

*In plain terms:* while the game is paused, a watch window or a hover can ask "what is `x + 1` right now?" and gets the value or a plain explanation, and asking never changes the game.

*Precisely:*

- **One expression, not a statement.** The text is parsed in the dialect of the paused thread's program and must be exactly one expression. A statement (`x = 1`, `if …`), a write of any kind (`=`, `+=` and the other compound forms, `++`, `--`), a `return`, a `class`/`function` definition, a lambda and a dictionary literal are all refused before anything runs.
- **Scope.** `frameDepth` is an index into the thread's `frames` (`0` is the outermost) and defaults to the innermost frame. Names resolve exactly as the paused frame resolves them: its own locals through their aliases (a captured cell, a by-reference parameter), then the enclosing frames, then the global table, then the engine virtuals. `threadId` must name a thread the view lists that still has frames.
- **Copied out.** The expression runs against a **copy** of the thread's frames and of the global table, so any value it writes is discarded with the copy, and the call leaves the state hash unchanged. An error it raises is reported as its result, never as a `TickReport` diagnostic, and never reaches the game's `error` event or a script handler.
- **Closed list of calls.** An expression may call only a **named** built-in whose catalogue row in [rpgcode-functions.md](rpgcode-functions.md) changes nothing and does not wait. The list is closed: it grows only by editing this table, and it is the whole of what `evaluate` will run.

| Built-in (as written) | Folded name | Why it is on the list |
|---|---|---|
| `castint`, `castnum`, `castlit` | `castint`, `castnum`, `castlit` | converts one value |
| `charat`, `chr`, `asc` | `charat`, `chr`, `asc` | reads or builds a character |
| `length`, `len` | `length`, `len` | measures a string; `len` is its alias |
| `instr` | `instr` | searches a string |
| `left`, `right`, `mid` | `left`, `right`, `mid` | takes a substring |
| `lcase`, `ucase` | `lcase`, `ucase` | changes a string's case |
| `replace` | `replace` | replaces one substring |
| `trim` | `trim` | trims whitespace |
| `sin`, `cos`, `tan`, `sqrt`, `log` | `sin`, `cos`, `tan`, `sqrt`, `log` | deterministic maths from `fmath` |
| `integermuldiv` | `integermuldiv` | exact whole-number arithmetic |
| `isNaN`, `isInfinity`, `isFinite` | `isnan`, `isinfinity`, `isfinite` | classifies a number |

Everything else is refused, including a call through a value (`f()` where `f` holds a callable), a method call, a constructor, a `file.`-qualified call, and every command that starts a thread, waits, writes a variable or a section, draws, plays audio, reads a file or consumes the seeded RNG; `random` is refused for that last reason.

- **Budget.** The expression may execute at most **1000** VM instructions — the same figure a thread gets per tick ([THR-3](rpgcode-errors-and-threads.md#thr-3)) — and reaching it is the error `evaluate.budget`. The budget bounds the instruction count, not the cost of one instruction, which is why the list above holds only commands whose own work is proportional to their arguments.

| Error code | Meaning |
|---|---|
| `evaluate.syntax` | the text is not one expression; the message carries the parser's reason |
| `evaluate.assignment` | the expression writes a variable, an element, a field or an object |
| `evaluate.call` | the expression calls something that is not on the list above, and the message names it |
| `evaluate.form` | the expression builds a value this reader does not have: a lambda, a dictionary literal or a class instance |
| `evaluate.budget` | the expression reached the 1000-instruction limit |
| `evaluate.thread` | `threadId` names no thread, or a thread with no frames left |
| `evaluate.frame` | `frameDepth` is not an index into that thread's frames |
| `evaluate.wait` | the expression entered a wait, which the list above cannot allow; reported rather than run |

Any other failure the expression raises while it runs is reported with the engine's own error code (`builtin.bad-arg`, `vm.modulo-by-zero` and so on) and its message, so a watch reads like the script does. The error carries the 1-based line of the expression text it happened on.

<!-- OWNER: P1, approved narrowly by Jensen 2026-11-11 (#950). Decided: one engine-side expression reader, expressions only, a named and closed list of pure built-ins, an instruction cap reported as `evaluate.budget`, a run on a copy whose effects are discarded, and a state hash that does not move. Rejected: evaluating in the adapter with a shadow interpreter — it would re-implement expression semantics (numeric truncation on a variable read SEM-3, comparison and truthiness SEM-3, the alias rules) and drift from the engine at the first change; evaluating by temporarily mutating engine state and rolling it back — a save, a queued event or an observer fires during the run and the rollback cannot undo it; allowing every built-in — a watch could `save()`, start a thread or block the host, and the read-only promise would be false; a time-based limit — it is not deterministic (G3) and would make one run of the same watch differ from the next. -->

<a id="tool-8-server"></a>
**TOOL-8 the session and its transport.** `dap` exports a transport-free session: the host hands it the engine to drive, the source the breakpoints name, and a callback that receives DAP responses and events. The stdio entry point is a program binary outside the package's public export (the same rule as [TOOL-1](#tool-1)), so importing the package never opens a pipe, and a test drives a session through an in-memory pair of streams. Breakpoints, the `threads`/`stackTrace`/`scopes`/`variables`/`evaluate` requests, `continue`, `next`, `stepIn` and `stepOut` are answered from `debugView()`, `evaluate()` and `setBreakpoints`, and the stepping requests are computed in the adapter per [THR-3](rpgcode-errors-and-threads.md#thr-3): one `advance(0, [], undefined, "step")` per instruction, comparing the frame depth of the stop with the depth the step started at.

<!-- OWNER: approved by Jensen 2026-11-11 (#950), as the wording P3 already ruled (THR-3, AD-1). Rejected: a `stepOver`/`stepIn`/`stepOut` mode inside the VM — it would put DAP's vocabulary in the save-state contract and add three cursor modes to the open-tick record. -->

**Host-visible stop events.** The adapter sends the standard DAP `stopped` event to the debug client and also sends the custom DAP event `rpgcode.stopped` with `{ reason, threadId, line }`. The VS Code extension-host API forwards this custom event through `onDidReceiveDebugSessionCustomEvent`, allowing host-side consumers and tests to await a stop without relying on the workbench's active-stack UI. It is emitted for entry, breakpoints, steps and instruction limits.

**Virtual source identity.** A launch may name its program source by URI, including a non-file workspace URI. Stack-frame sources retain that URI so the host can resolve the document; `setBreakpoints` accepts either that URI or its path as the source name. This keeps virtual-file-system breakpoints aligned with the program document instead of resolving the path through the host's default file system.

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
  "results": { "lint": { "disabledRules": [], "ignoredRanges": 0, "unassessed": [] } }
}
```

`status` is `ok`, `findings` or `error` and agrees with `exitCode`. `diagnostics` carries [TOOL-3](#tool-3) objects themselves — the same objects the language server publishes, so a CI job and an editor see one shape. `results` holds the subcommand's own payload: the lint summary for `check` (`results.lint` with `disabledRules`, `ignoredRanges` and `unassessed`, [TOOL-3 assessment](#tool-3-assessment)), the changed paths for `fmt`, the cases with expected and actual for `test`, the written path or a drift list for `docs`, and the [TOOL-6](#tool-6) document for `index`. The schema is [schemas/tkr-script-result.schema.json](../schemas/tkr-script-result.schema.json); a test validates every subcommand's `--json` output against it.

**Stability promise.** Adding an optional field or an enumerated value is a minor change; removing, retyping or renaming a field, or adding or repurposing an exit code, is a major one.

<!-- OWNER: D-9, approved 2026-10-31. Rejected: one non-zero code for everything — a CI job or a wrapper could then not tell "your script has a warning" from "your config is broken" from "the tool crashed", which is the distinction --strict and --fix workflows turn on; and a per-subcommand envelope would mean two schemas to version for one contract. -->
