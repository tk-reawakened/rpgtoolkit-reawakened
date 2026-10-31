---
title: "Source spans and the script-tools library: columns, end offsets and one diagnostic model"
ticket: 3
status: done
---

## Intent

Entry 10.3 is the epic's first code entry: it makes a diagnostic able to name **exactly** the text it is about, and gives the LSP (10.1/10.5), the linter (10.6), the CLI (10.9) and the formatter (10.7) one place to get that answer. It adds no behaviour to the engine: every op, state hash, golden and snapshot must stay byte-identical, and the only new runtime surface is a new pure package.

The range convention was settled while the scanner was implemented and is recorded normatively in `docs/spec/engine/rpgcode-tooling.md#tool-3-range-convention` and on the `Token` type: **UTF-16 code units of the decoded source, lines and columns 1-based, columns inclusive**. A token never spans a line; a zero-width token has `endCol === col`; the CR of a CRLF does not count; a Windows-1252 byte is one column and a supplementary-plane character is two.

## Slices

| Slice | What it changes | Gate |
|---|---|---|
| A. Token spans (landed as `c7b00d37`, convention ruling `3c7a854d`) | `packages/core/src/script/lex.ts`: every `Token` variant carries `col`/`endCol`, computed from a `lineStart` cursor at all 14 emission sites; `packages/core/test/script-lex-spans.test.ts` (11 tests) | whole suite |
| B. Spans in the AST and `SourcePos` | `ast.ts` node types, `parse.ts` construction sites, `ops.ts` `SourcePos`, `lower.ts` `getPos`, and the `ScriptError` positions thrown by the lexer and parser so a diagnostic's range is the offending token's range | whole suite: every golden, state hash and snapshot byte-identical |
| C. `packages/script-tools` | the package, its `analyse()` entry producing the TOOL-3 diagnostic model over the core parser, the help projection over `commandDocumentation()`, the dependency edge and the graph diagram | `graph`, `lint`, the package's tests |

## Decision: the new AST node fields are optional; `Token`'s are required

`Token` lives in a closed union that only the scanner constructs, so `col`/`endCol` are **required** there: a token without a span is a bug the compiler should catch, and the landed slice already made them required with no literal in the tree to update.

AST nodes and `SourcePos` get **optional** `col?: number` and `endCol?: number`, for three reasons:

1. The entry's own contract says "adds **optional** start and end columns … to tokens, AST nodes and `SourcePos`". A required field would make every hand-written node literal in a test a compile error for a fact the fixture was never built to state, and it would be a breaking source change to a type the ticket calls additive.
2. `SourcePos` is shared with every `StepOp` and with runtime `ScriptError` positions, several of which have no token at all (a diagnostic about a save file, a built-in that fails with no source site, a synthesized op). A required column would force every one of those to invent a value — the opposite of "the range is exact".
3. The parser stamps the fields at **every** site it can, so the information is present wherever a real token exists; optionality records that "there is no span" is a legitimate state rather than pretending there is one. A consumer that needs a range handles absence explicitly at one boundary (the diagnostic model's `rangeOf`), and entry 10.4's index and 10.6's rules then rely on the stamping, not on the type's strictness.

The same rule fixes the anchor: a node's `line`, `col` and `endCol` all come from **one** token (the token the existing `line` already came from; a composite node inherits its first child's, exactly as its `line` did). That keeps the node range one line long — the property TOOL-3 needs to slice — without inventing an `endLine` the ticket does not ask for.

## Files

- `packages/core/src/script/ast.ts` — optional `col`/`endCol` on every node type that carries `line` (params, functions, members, methods, classes, all 20 `Expr` variants, `ObjectEntry`, `IfBranch`, `SwitchCase`, all 8 `Statement` variants, `IncludeRequest`).
- `packages/core/src/script/parse.ts` — stamp all construction sites from the anchor token, including the `ScriptError` positions it throws.
- `packages/core/src/script/lex.ts` — `ScriptError` positions carry the offending character's column, so a lexical error slices exactly.
- `packages/core/src/script/ops.ts` — optional fields on `SourcePos`, documented against TOOL-3.
- `packages/core/src/script/lower.ts` — `getPos` accepts the node and carries the span into every `StepOp.pos`.
- `packages/core/test/script-spans-ast.test.ts` — the token **and node** table the entry's verify asks for, over a program with a tab, CRLF and a Windows-1252 byte, plus the slice assertion.
- `packages/script-tools/**` — `analyse()`, the help projection, the TOOL-3 types, tests.
- `tools/deps/edges.json` and the generated diagram in the architecture spine — the `core → script-tools` edge.

## Verify, mapped

| Ticket verify | Where |
|---|---|
| every existing test, golden and state hash unchanged | the full gate list, run from the worktree; nothing re-recorded |
| a token and node table test asserts start and end columns for a program with tabs, CRLF and a Windows-1252 byte | `packages/core/test/script-spans-ast.test.ts` |
| slicing the source with a diagnostic's range yields exactly the offending token | `packages/script-tools/test/analyse.test.ts` |
| `script-tools` imports no Node API and passes the dependency-graph rule | package `tsconfig` (`lib: ES2022`, `types: []`), `pnpm graph`, `pnpm lint` |

## Out of scope

No linter rule (10.6), no formatter (10.7), no index document (10.4), no LSP transport (10.1). The help projection is a pure function of the resolved plugin definitions; it does not read `docs/` or the filesystem.

## Landing

Merged as **`4a58476df822bf2040d44958edfb9cddc5423509`** — "feat(10.3): source spans in the scanner, AST and IR; script-tools analyse and help (#939)" (PR [#971](https://github.com/tk-reawakened/rpgtoolkit-reawakened/pull/971), squash). Issue #939 closed as completed.

Six commits: the scanner spans (the inherited first slice), the UTF-16 ruling, the range-convention section and this plan; then the AST/`SourcePos`/error spans, `packages/script-tools` with the dependency edge, and the CI test shard.

Gates at the final head `f78b3607`: `fixtures:fetch` fetched; `typecheck` exit 0; `lint` exit 0; `test:strict` 2485/2485 pass, 0 skipped; `fixtures:author:check` matched; `golden` exit 0; `golden:bun` identical and closing 8/8; `graph` no violations (526 modules, 2667 dependencies); `licence` passed; `provenance` 0 violations; `catalogue:check` matched; `command-docs:check` exit 0; `closing` 8/8. CI run 41244758388 green on all 12 checks, including the new `unit (script-tools)` shard and the coverage `gate`.

**No golden, state hash or snapshot moved and none was re-recorded.** Three structural comparisons that carried `line` only now compare the span-blind view (the OOP parser goldens) or the exact new spans; the golden files themselves are untouched.
